import AuthenticationServices
import Foundation
import UIKit

enum PasskeyCoordinatorError: LocalizedError, Equatable {
    case invalidOptions
    case unexpectedCredential
    case alreadyRunning
    case cancelled
    case authorization(String)

    var errorDescription: String? {
        switch self {
        case .invalidOptions:
            "服务器返回的设备密钥参数无效，请重新开始。"
        case .unexpectedCredential:
            "系统没有返回可用的设备密钥。"
        case .alreadyRunning:
            "另一个设备密钥请求仍在进行。"
        case .cancelled:
            "已取消设备密钥操作。"
        case .authorization(let detail):
            detail
        }
    }
}

@MainActor
final class PasskeyCoordinator: NSObject {
    private let presentationAnchorProvider: () -> ASPresentationAnchor
    private var continuation: CheckedContinuation<ASAuthorization, Error>?
    private var controller: ASAuthorizationController?

    init(presentationAnchorProvider: (() -> ASPresentationAnchor)? = nil) {
        self.presentationAnchorProvider = presentationAnchorProvider ?? Self.defaultPresentationAnchor
        super.init()
    }

    func register(using options: PublicKeyRegistrationOptions) async throws -> PasskeyCredentialPayload {
        guard let challenge = Data(base64URLEncoded: options.challenge),
              let userID = Data(base64URLEncoded: options.user.id),
              !options.rp.id.isEmpty else {
            throw PasskeyCoordinatorError.invalidOptions
        }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
            relyingPartyIdentifier: options.rp.id
        )
        let request = provider.createCredentialRegistrationRequest(
            challenge: challenge,
            name: options.user.name,
            userID: userID
        )
        request.displayName = options.user.displayName
        request.userVerificationPreference = .required
        request.attestationPreference = .none

        if #available(iOS 17.4, *) {
            request.excludedCredentials = (options.excludeCredentials ?? []).compactMap { descriptor in
                guard let id = Data(base64URLEncoded: descriptor.id) else { return nil }
                return ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: id)
            }
        }

        let authorization = try await perform(request)
        guard let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
              let attestation = credential.rawAttestationObject else {
            throw PasskeyCoordinatorError.unexpectedCredential
        }
        let credentialID = credential.credentialID.base64URLEncodedString()
        return PasskeyCredentialPayload(
            id: credentialID,
            rawId: credentialID,
            response: .init(
                clientDataJSON: credential.rawClientDataJSON.base64URLEncodedString(),
                attestationObject: attestation.base64URLEncodedString(),
                authenticatorData: nil,
                signature: nil,
                userHandle: nil,
                transports: ["internal"]
            )
        )
    }

    func authenticate(using options: PublicKeyAuthenticationOptions) async throws -> PasskeyCredentialPayload {
        guard let challenge = Data(base64URLEncoded: options.challenge), !options.rpId.isEmpty else {
            throw PasskeyCoordinatorError.invalidOptions
        }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
            relyingPartyIdentifier: options.rpId
        )
        let request = provider.createCredentialAssertionRequest(challenge: challenge)
        request.userVerificationPreference = .required
        request.allowedCredentials = (options.allowCredentials ?? []).compactMap { descriptor in
            guard let id = Data(base64URLEncoded: descriptor.id) else { return nil }
            return ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: id)
        }

        let authorization = try await perform(request)
        guard let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
            throw PasskeyCoordinatorError.unexpectedCredential
        }
        let credentialID = credential.credentialID.base64URLEncodedString()
        return PasskeyCredentialPayload(
            id: credentialID,
            rawId: credentialID,
            response: .init(
                clientDataJSON: credential.rawClientDataJSON.base64URLEncodedString(),
                attestationObject: nil,
                authenticatorData: credential.rawAuthenticatorData.base64URLEncodedString(),
                signature: credential.signature.base64URLEncodedString(),
                userHandle: credential.userID.base64URLEncodedString(),
                transports: nil
            )
        )
    }

    private func perform(_ request: ASAuthorizationRequest) async throws -> ASAuthorization {
        guard continuation == nil else { throw PasskeyCoordinatorError.alreadyRunning }
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let controller = ASAuthorizationController(authorizationRequests: [request])
            self.controller = controller
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    private func finish(with result: Result<ASAuthorization, Error>) {
        let continuation = continuation
        self.continuation = nil
        controller = nil
        continuation?.resume(with: result)
    }

    private static func defaultPresentationAnchor() -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        if let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) {
            return window
        }
        if let window = scenes.flatMap(\.windows).first { return window }
        return UIWindow(frame: UIScreen.main.bounds)
    }
}

extension PasskeyCoordinator: ASAuthorizationControllerDelegate {
    nonisolated func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        Task { @MainActor in finish(with: .success(authorization)) }
    }

    nonisolated func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        let mapped: Error
        if let authorizationError = error as? ASAuthorizationError,
           authorizationError.code == .canceled {
            mapped = PasskeyCoordinatorError.cancelled
        } else {
            mapped = PasskeyCoordinatorError.authorization(error.localizedDescription)
        }
        Task { @MainActor in finish(with: .failure(mapped)) }
    }
}

extension PasskeyCoordinator: ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        presentationAnchorProvider()
    }
}

extension Data {
    init?(base64URLEncoded value: String) {
        var normalized = value.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        normalized += String(repeating: "=", count: (4 - normalized.count % 4) % 4)
        guard let data = Data(base64Encoded: normalized) else { return nil }
        self = data
    }

    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
