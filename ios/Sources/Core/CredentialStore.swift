import Foundation
import Security

protocol BearerTokenStoring: AnyObject {
    func readToken() throws -> String?
    func saveToken(_ token: String) throws
    func deleteToken() throws
}

enum CredentialStoreError: LocalizedError, Equatable {
    case invalidData
    case keychain(OSStatus)

    var errorDescription: String? {
        switch self {
        case .invalidData:
            "设备登录凭据格式无效。"
        case .keychain(let status):
            "无法访问系统钥匙串（\(status)）。"
        }
    }
}

final class KeychainBearerTokenStore: BearerTokenStoring {
    private let service: String
    private let account: String

    init(
        service: String = "io.bigrandall.rmusic.authentication",
        account: String = "native-bearer"
    ) {
        self.service = service
        self.account = account
    }

    func readToken() throws -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw CredentialStoreError.keychain(status) }
        guard let data = result as? Data,
              let token = String(data: data, encoding: .utf8),
              token.hasPrefix("rmu_") else {
            throw CredentialStoreError.invalidData
        }
        return token
    }

    func saveToken(_ token: String) throws {
        guard token.hasPrefix("rmu_"), let data = token.data(using: .utf8) else {
            throw CredentialStoreError.invalidData
        }

        var attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw CredentialStoreError.keychain(updateStatus)
        }

        attributes.merge(baseQuery) { current, _ in current }
        let addStatus = SecItemAdd(attributes as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw CredentialStoreError.keychain(addStatus) }
    }

    func deleteToken() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw CredentialStoreError.keychain(status)
        }
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}

/// Deterministic credential storage for unit tests, previews and dependency injection.
final class InMemoryBearerTokenStore: BearerTokenStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var token: String?

    init(token: String? = nil) {
        self.token = token
    }

    func readToken() throws -> String? {
        lock.lock()
        defer { lock.unlock() }
        return token
    }

    func saveToken(_ token: String) throws {
        guard token.hasPrefix("rmu_") else { throw CredentialStoreError.invalidData }
        lock.lock()
        self.token = token
        lock.unlock()
    }

    func deleteToken() throws {
        lock.lock()
        token = nil
        lock.unlock()
    }
}
