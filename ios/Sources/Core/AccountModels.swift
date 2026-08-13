import Foundation

struct AccountUser: Codable, Hashable, Sendable, Identifiable {
    let id: String
    var displayName: String
    let createdAt: Date
    let lastLoginAt: Date?
    let passkeyCount: Int

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        id = container.string(for: "id") ?? ""
        displayName = container.string(for: "displayName")
            ?? container.string(for: "display_name")
            ?? "RMusic 用户"
        createdAt = container.date(for: "createdAt")
            ?? container.date(for: "created_at")
            ?? .distantPast
        lastLoginAt = container.date(for: "lastLoginAt") ?? container.date(for: "last_login_at")
        passkeyCount = container.int(for: "passkeyCount")
            ?? container.int(for: "passkey_count")
            ?? 0
    }

    var initials: String {
        let letters = displayName
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .prefix(2)
            .compactMap(\.first)
        let value = letters.isEmpty ? Array(displayName.prefix(2)) : Array(letters)
        return String(value).uppercased()
    }

    var shortID: String { String(id.prefix(8)).uppercased() }
}

typealias RMusicUser = AccountUser

struct PasskeyDevice: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let name: String
    let deviceType: String
    let backedUp: Bool
    let transports: [String]
    let createdAt: Date
    let lastUsedAt: Date?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        id = container.string(for: "id") ?? ""
        name = container.string(for: "name") ?? "设备密钥"
        deviceType = container.string(for: "deviceType")
            ?? container.string(for: "device_type")
            ?? "singleDevice"
        backedUp = container.bool(for: "backedUp")
            ?? container.bool(for: "backed_up")
            ?? false
        transports = (try? container.decode([String].self, forKey: .init("transports"))) ?? []
        createdAt = container.date(for: "createdAt")
            ?? container.date(for: "created_at")
            ?? .distantPast
        lastUsedAt = container.date(for: "lastUsedAt") ?? container.date(for: "last_used_at")
    }

    var lastUsedDescription: String {
        RelativeDateDescription.string(for: lastUsedAt ?? createdAt)
    }
}

enum AccountSessionKind: String, Codable, Hashable, Sendable {
    case native
    case web

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self = AccountSessionKind(rawValue: (try? container.decode(String.self)) ?? "") ?? .web
    }
}

struct UserSession: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let kind: AccountSessionKind
    let current: Bool
    let createdAt: Date
    let expiresAt: Date
    let lastUsedAt: Date
    let userAgent: String

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        id = container.string(for: "id") ?? ""
        kind = AccountSessionKind(rawValue: container.string(for: "kind") ?? "") ?? .native
        current = container.bool(for: "current") ?? false
        createdAt = container.date(for: "createdAt")
            ?? container.date(for: "created_at")
            ?? .distantPast
        expiresAt = container.date(for: "expiresAt")
            ?? container.date(for: "expires_at")
            ?? .distantPast
        lastUsedAt = container.date(for: "lastUsedAt")
            ?? container.date(for: "last_used_at")
            ?? createdAt
        userAgent = container.string(for: "userAgent")
            ?? container.string(for: "user_agent")
            ?? ""
    }

    var lastUsedDescription: String { RelativeDateDescription.string(for: lastUsedAt) }
}

typealias AccountSession = UserSession

struct AccountStatus: Decodable, Sendable {
    let authenticated: Bool
    let user: AccountUser?
    let session: UserSession?
    let accessToken: String?
    let tokenType: String?
}

struct ProxySessionStatus: Decodable, Hashable, Sendable {
    let authenticated: Bool
    let accountAuthenticated: Bool
    let expiresAt: Date
    let refreshAfter: Date

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        authenticated = container.bool(for: "authenticated") ?? false
        accountAuthenticated = container.bool(for: "accountAuthenticated")
            ?? container.bool(for: "account_authenticated")
            ?? false
        expiresAt = container.date(for: "expiresAt")
            ?? container.date(for: "expires_at")
            ?? .distantPast
        refreshAfter = container.date(for: "refreshAfter")
            ?? container.date(for: "refresh_after")
            ?? .distantPast
    }
}

struct PasskeyRegistrationOptions: Decodable, Sendable {
    let flowId: String
    let options: PublicKeyRegistrationOptions
}

struct PublicKeyRegistrationOptions: Decodable, Sendable {
    struct RelyingParty: Decodable, Sendable {
        let id: String
        let name: String?
    }

    struct User: Decodable, Sendable {
        let id: String
        let name: String
        let displayName: String
    }

    let challenge: String
    let rp: RelyingParty
    let user: User
    let timeout: Int?
    let excludeCredentials: [PublicKeyCredentialDescriptor]?
}

struct PasskeyAuthenticationOptions: Decodable, Sendable {
    let flowId: String
    let options: PublicKeyAuthenticationOptions
}

struct PublicKeyAuthenticationOptions: Decodable, Sendable {
    let challenge: String
    let rpId: String
    let timeout: Int?
    let allowCredentials: [PublicKeyCredentialDescriptor]?
}

struct PublicKeyCredentialDescriptor: Codable, Hashable, Sendable {
    let id: String
    let type: String
    let transports: [String]?
}

struct PasskeyCredentialPayload: Encodable, Sendable {
    struct Response: Encodable, Sendable {
        let clientDataJSON: String
        let attestationObject: String?
        let authenticatorData: String?
        let signature: String?
        let userHandle: String?
        let transports: [String]?
    }

    let id: String
    let rawId: String
    let type = "public-key"
    let response: Response
    let clientExtensionResults: [String: String] = [:]
    let authenticatorAttachment = "platform"
}

struct DevicesPayload: Decodable, Sendable {
    let devices: [PasskeyDevice]
}

struct SessionsPayload: Decodable, Sendable {
    let sessions: [UserSession]
}

struct UserPayload: Decodable, Sendable {
    let user: AccountUser
}

struct AddedDevicePayload: Decodable, Sendable {
    let verified: Bool
    let user: AccountUser
    let device: PasskeyDevice
}

private extension KeyedDecodingContainer where Key == DynamicCodingKey {
    func string(for name: String) -> String? {
        let key = DynamicCodingKey(name)
        if let value = try? decodeIfPresent(String.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return String(value) }
        return nil
    }

    func int(for name: String) -> Int? {
        let key = DynamicCodingKey(name)
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Double.self, forKey: key) { return Int(value) }
        if let value = try? decodeIfPresent(String.self, forKey: key) { return Double(value).map(Int.init) }
        return nil
    }

    func bool(for name: String) -> Bool? {
        let key = DynamicCodingKey(name)
        if let value = try? decodeIfPresent(Bool.self, forKey: key) { return value }
        if let value = int(for: name) { return value != 0 }
        if let value = string(for: name) {
            if ["true", "yes"].contains(value.lowercased()) { return true }
            if ["false", "no"].contains(value.lowercased()) { return false }
        }
        return nil
    }

    func date(for name: String) -> Date? {
        let key = DynamicCodingKey(name)
        if let value = try? decodeIfPresent(Double.self, forKey: key) {
            return Date(millisecondsOrSecondsSince1970: value)
        }
        if let value = string(for: name) {
            if let number = Double(value) { return Date(millisecondsOrSecondsSince1970: number) }
            return ISO8601DateFormatter().date(from: value)
        }
        return nil
    }
}

private enum RelativeDateDescription {
    static func string(for date: Date) -> String {
        guard date != .distantPast else { return "未知" }
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    private static let formatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: "zh_Hans_CN")
        formatter.unitsStyle = .full
        return formatter
    }()
}
