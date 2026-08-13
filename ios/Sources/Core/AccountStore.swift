import Foundation
import Observation
import UIKit

@MainActor
@Observable
final class AccountStore {
    private(set) var user: AccountUser?
    private(set) var devices: [PasskeyDevice] = []
    private(set) var sessions: [UserSession] = []
    private(set) var isLoading = false
    private(set) var errorMessage: String?

    var isAuthenticated: Bool { user != nil }

    let api: RMusicAPIClient
    private let passkeys: PasskeyCoordinator

    init(
        api: RMusicAPIClient? = nil,
        passkeys: PasskeyCoordinator? = nil
    ) {
        self.api = api ?? .shared
        self.passkeys = passkeys ?? PasskeyCoordinator()
    }

    func restore() async {
        await perform(clearError: true) {
            let status = try await api.accountStatus()
            apply(status)
            if status.authenticated {
                async let loadedDevices = api.devices()
                async let loadedSessions = api.sessions()
                devices = try await loadedDevices
                sessions = try await loadedSessions
                _ = try? await api.bootstrapProxySession()
            } else {
                api.clearCredentials()
                clearAccountState()
            }
        }
    }

    func register(displayName: String, deviceName: String? = nil) async throws {
        try await performingThrowing {
            let begin = try await api.registrationOptions(displayName: displayName)
            let credential = try await passkeys.register(using: begin.options)
            let status = try await api.verifyRegistration(
                flowID: begin.flowId,
                credential: credential,
                deviceName: normalizedDeviceName(deviceName)
            )
            apply(status)
            _ = try await api.bootstrapProxySession(force: true)
            try await refreshSecurityDetails()
        }
    }

    func login(deviceName: String? = nil) async throws {
        try await performingThrowing {
            let begin = try await api.loginOptions()
            let credential = try await passkeys.authenticate(using: begin.options)
            let status = try await api.verifyLogin(
                flowID: begin.flowId,
                credential: credential,
                deviceName: normalizedDeviceName(deviceName)
            )
            apply(status)
            _ = try await api.bootstrapProxySession(force: true)
            try await refreshSecurityDetails()
        }
    }

    func addPasskey(deviceName: String? = nil) async throws {
        try await performingThrowing {
            let begin = try await api.addDeviceOptions()
            let credential = try await passkeys.register(using: begin.options)
            let payload = try await api.verifyAddedDevice(
                flowID: begin.flowId,
                credential: credential,
                deviceName: normalizedDeviceName(deviceName)
            )
            user = payload.user
            devices = try await api.devices()
        }
    }

    func updateDisplayName(_ displayName: String) async throws {
        try await performingThrowing {
            user = try await api.updateProfile(displayName: displayName)
        }
    }

    func refreshSecurityDetails() async throws {
        async let loadedDevices = api.devices()
        async let loadedSessions = api.sessions()
        devices = try await loadedDevices
        sessions = try await loadedSessions
    }

    func removeDevice(_ device: PasskeyDevice) async throws {
        try await performingThrowing {
            try await api.removeDevice(id: device.id)
            devices.removeAll { $0.id == device.id }
            if let current = user {
                let status = try await api.accountStatus()
                user = status.user ?? current
            }
        }
    }

    func revokeSession(_ session: UserSession) async throws {
        try await performingThrowing {
            try await api.revokeSession(id: session.id)
            if session.current {
                api.clearCredentials()
                clearAccountState()
            } else {
                sessions.removeAll { $0.id == session.id }
            }
        }
    }

    func logout() async {
        isLoading = true
        defer { isLoading = false }
        do {
            try await api.logout()
        } catch {
            errorMessage = Self.message(for: error)
            api.clearCredentials()
        }
        clearAccountState()
    }

    func clearError() {
        errorMessage = nil
    }

    private func apply(_ status: AccountStatus) {
        guard status.authenticated else {
            clearAccountState()
            return
        }
        user = status.user
        if let session = status.session {
            sessions = [session]
        }
    }

    private func clearAccountState() {
        user = nil
        devices = []
        sessions = []
    }

    private func normalizedDeviceName(_ value: String?) -> String {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return String((trimmed.isEmpty ? UIDevice.current.name : trimmed).prefix(50))
    }

    private func perform(clearError: Bool, operation: () async throws -> Void) async {
        if clearError { errorMessage = nil }
        isLoading = true
        defer { isLoading = false }
        do {
            try await operation()
        } catch {
            if (error as? RMusicAPIError)?.statusCode == 401 {
                api.clearCredentials()
                clearAccountState()
            }
            errorMessage = Self.message(for: error)
        }
    }

    private func performingThrowing(operation: () async throws -> Void) async throws {
        errorMessage = nil
        isLoading = true
        defer { isLoading = false }
        do {
            try await operation()
        } catch {
            errorMessage = Self.message(for: error)
            throw error
        }
    }

    private static func message(for error: Error) -> String {
        if let localized = error as? LocalizedError, let message = localized.errorDescription {
            return message
        }
        return error.localizedDescription
    }
}
