import SwiftUI

struct AccountView: View {
    @Environment(RMusicAppModel.self) private var model
    @State private var displayName = ""
    @State private var isWorking = false
    @State private var localError: String?
    @State private var editingName = false
    @State private var pendingDeviceRemoval: PasskeyDevice?
    @State private var pendingSessionRevocation: UserSession?
    @State private var confirmLogout = false

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20) {
                if model.account.isAuthenticated {
                    signedIn
                } else {
                    signedOut
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 24)
        }
        .navigationTitle("账号")
        .refreshable {
            if model.account.isAuthenticated { await model.refreshAccount() }
            else { await model.account.restore() }
        }
        .confirmationDialog("移除设备密钥？", isPresented: deviceRemovalPresented, titleVisibility: .visible) {
            Button("移除", role: .destructive) {
                guard let device = pendingDeviceRemoval else { return }
                Task { await perform { try await model.removePasskey(device) } }
            }
            Button("取消", role: .cancel) { pendingDeviceRemoval = nil }
        } message: {
            Text("移除后，这个设备密钥将不能再登录 RMusic。至少必须保留一个。")
        }
        .confirmationDialog("注销这个会话？", isPresented: sessionRevocationPresented, titleVisibility: .visible) {
            Button("注销", role: .destructive) {
                guard let session = pendingSessionRevocation else { return }
                Task { await perform { try await model.revokeSession(session) } }
            }
            Button("取消", role: .cancel) { pendingSessionRevocation = nil }
        } message: {
            Text("对应设备上的 RMusic 将需要重新使用设备密钥登录。")
        }
        .confirmationDialog("退出 RMusic？", isPresented: $confirmLogout, titleVisibility: .visible) {
            Button("退出登录", role: .destructive) {
                Task { await perform { try await model.logout() } }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("退出会立即停止播放，并清空内存中的队列和个人音乐库。")
        }
    }

    private var signedOut: some View {
        VStack(spacing: 22) {
            VStack(spacing: 14) {
                ZStack {
                    Circle()
                        .fill(RMusicTheme.violet.opacity(0.16))
                        .frame(width: 118, height: 118)
                    Circle()
                        .stroke(RMusicTheme.accent.opacity(0.2), lineWidth: 1)
                        .frame(width: 92, height: 92)
                    Image(systemName: "key.fill")
                        .font(.system(size: 42, weight: .semibold))
                        .foregroundStyle(RMusicTheme.accent)
                }

                Text("不用账号密码")
                    .font(.largeTitle.weight(.bold))
                    .tracking(-0.8)
                Text("RMusic ID 使用系统设备密钥和 Face ID。没有邮箱、手机号或密码，私钥始终保留在你的设备和密码管理器中。")
                    .font(.subheadline)
                    .foregroundStyle(RMusicTheme.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("显示名称（创建时使用）")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(RMusicTheme.textSecondary)
                TextField("例如 Randall", text: $displayName)
                    .textContentType(.nickname)
                    .padding(14)
                    .background(RMusicTheme.surfaceRaised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }

            if let message = localError ?? model.account.errorMessage {
                ErrorBanner(message: message)
            }

            VStack(spacing: 12) {
                Button {
                    Task { await perform { try await model.registerAccount(displayName: displayName) } }
                } label: {
                    accountButtonLabel("创建 RMusic ID", symbol: "person.badge.key.fill", primary: true)
                }
                .disabled(isWorking)
                .buttonStyle(RMusicPressStyle())

                Button {
                    Task { await perform { try await model.loginAccount() } }
                } label: {
                    accountButtonLabel("使用设备密钥登录", symbol: "key.horizontal.fill", primary: false)
                }
                .disabled(isWorking)
                .buttonStyle(RMusicPressStyle())
            }

            Label("浏览和搜索无需登录；播放、收藏和云端歌单需要 RMusic ID。", systemImage: "hand.raised.fill")
                .font(.caption)
                .foregroundStyle(RMusicTheme.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .rmusicCard(padding: 24)
    }

    private var signedIn: some View {
        Group {
            if let user = model.account.user {
                profileCard(user)
            }

            if let message = localError ?? model.account.errorMessage {
                ErrorBanner(message: message)
            }

            accountSection(title: "设备密钥", subtitle: "用于安全登录，不保存密码") {
                if model.account.devices.isEmpty {
                    Text("暂时无法读取设备密钥")
                        .foregroundStyle(RMusicTheme.textSecondary)
                        .padding()
                } else {
                    ForEach(model.account.devices) { device in
                        deviceRow(device)
                        if device.id != model.account.devices.last?.id {
                            Divider().overlay(RMusicTheme.separator)
                        }
                    }
                }

                Button {
                    Task { await perform { try await model.addPasskey() } }
                } label: {
                    Label("添加设备密钥", systemImage: "plus.circle.fill")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(RMusicTheme.accent)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 12)
                }
                .buttonStyle(RMusicPressStyle())
            }

            accountSection(title: "登录会话", subtitle: "可以远程注销不再使用的设备") {
                if model.account.sessions.isEmpty {
                    Text("暂时无法读取登录会话")
                        .foregroundStyle(RMusicTheme.textSecondary)
                        .padding()
                } else {
                    ForEach(model.account.sessions) { session in
                        sessionRow(session)
                        if session.id != model.account.sessions.last?.id {
                            Divider().overlay(RMusicTheme.separator)
                        }
                    }
                }
            }

            Button(role: .destructive) { confirmLogout = true } label: {
                Label("退出登录", systemImage: "rectangle.portrait.and.arrow.right")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(RMusicTheme.danger.opacity(0.10), in: Capsule())
            }
            .buttonStyle(RMusicPressStyle())
        }
    }

    private func profileCard(_ user: AccountUser) -> some View {
        HStack(spacing: 16) {
            Text(user.initials)
                .font(.title2.weight(.black))
                .foregroundStyle(RMusicTheme.accentInk)
                .frame(width: 62, height: 62)
                .background(RMusicTheme.accent, in: Circle())

            VStack(alignment: .leading, spacing: 5) {
                if editingName {
                    TextField("显示名称", text: $displayName)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit {
                            Task { await updateName() }
                        }
                } else {
                    Text(user.displayName)
                        .font(.title2.weight(.bold))
                }
                Text("RMusic ID · \(user.shortID)")
                    .font(.caption.monospaced())
                    .foregroundStyle(RMusicTheme.textSecondary)
            }
            Spacer()
            Button {
                if editingName {
                    Task { await updateName() }
                } else {
                    displayName = user.displayName
                    editingName = true
                }
            } label: {
                Image(systemName: editingName ? "checkmark" : "pencil")
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(RMusicPressStyle(pressedScale: 0.9))
            .accessibilityLabel(editingName ? "保存显示名称" : "修改显示名称")
        }
        .rmusicCard(padding: 18)
    }

    private func accountSection<Content: View>(title: String, subtitle: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.title3.weight(.bold))
                Text(subtitle).font(.caption).foregroundStyle(RMusicTheme.textSecondary)
            }
            VStack(spacing: 0, content: content)
                .padding(.horizontal, 14)
                .background(RMusicTheme.surface, in: RoundedRectangle(cornerRadius: RMusicTheme.radius, style: .continuous))
        }
    }

    private func deviceRow(_ device: PasskeyDevice) -> some View {
        HStack(spacing: 12) {
            Image(systemName: device.backedUp ? "key.radiowaves.forward.fill" : "key.fill")
                .foregroundStyle(RMusicTheme.accent)
                .frame(width: 36, height: 36)
                .background(RMusicTheme.accent.opacity(0.10), in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text(device.name).font(.subheadline.weight(.semibold))
                Text("\(device.backedUp ? "可同步" : "仅此设备") · \(device.lastUsedDescription)")
                    .font(.caption)
                    .foregroundStyle(RMusicTheme.textSecondary)
            }
            Spacer()
            Button(role: .destructive) { pendingDeviceRemoval = device } label: {
                Image(systemName: "trash")
                    .frame(width: 44, height: 44)
            }
            .disabled(model.account.devices.count <= 1)
            .buttonStyle(RMusicPressStyle(pressedScale: 0.9))
            .accessibilityLabel("移除 \(device.name)")
        }
        .padding(.vertical, 8)
    }

    private func sessionRow(_ session: UserSession) -> some View {
        HStack(spacing: 12) {
            Image(systemName: session.kind == .native ? "iphone" : "safari")
                .foregroundStyle(session.current ? RMusicTheme.accent : RMusicTheme.textSecondary)
                .frame(width: 36, height: 36)
                .background(.white.opacity(0.06), in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(session.kind == .native ? "RMusic 手机客户端" : "RMusic 网页")
                        .font(.subheadline.weight(.semibold))
                    if session.current {
                        Text("当前")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(RMusicTheme.accentInk)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(RMusicTheme.accent, in: Capsule())
                    }
                }
                Text("最近活动 \(session.lastUsedDescription)")
                    .font(.caption)
                    .foregroundStyle(RMusicTheme.textSecondary)
            }
            Spacer()
            if !session.current {
                Button(role: .destructive) { pendingSessionRevocation = session } label: {
                    Image(systemName: "xmark.circle")
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(RMusicPressStyle(pressedScale: 0.9))
                .accessibilityLabel("注销这个会话")
            }
        }
        .padding(.vertical, 8)
    }

    private func accountButtonLabel(_ title: String, symbol: String, primary: Bool) -> some View {
        HStack(spacing: 10) {
            if isWorking { ProgressView().tint(primary ? RMusicTheme.accentInk : RMusicTheme.textPrimary) }
            else { Image(systemName: symbol) }
            Text(title)
        }
        .font(.headline)
        .foregroundStyle(primary ? RMusicTheme.accentInk : RMusicTheme.textPrimary)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(primary ? RMusicTheme.accent : RMusicTheme.surfaceRaised, in: Capsule())
        .overlay { if !primary { Capsule().stroke(RMusicTheme.separator, lineWidth: 1) } }
    }

    private var deviceRemovalPresented: Binding<Bool> {
        Binding(get: { pendingDeviceRemoval != nil }, set: { if !$0 { pendingDeviceRemoval = nil } })
    }

    private var sessionRevocationPresented: Binding<Bool> {
        Binding(get: { pendingSessionRevocation != nil }, set: { if !$0 { pendingSessionRevocation = nil } })
    }

    private func perform(_ action: @escaping () async throws -> Void) async {
        isWorking = true
        localError = nil
        do {
            try await action()
            RMusicHaptics.notification(.success)
        } catch {
            localError = model.message(for: error)
            RMusicHaptics.notification(.error)
        }
        isWorking = false
        pendingDeviceRemoval = nil
        pendingSessionRevocation = nil
    }

    private func updateName() async {
        let value = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        await perform { try await model.updateDisplayName(value) }
        if localError == nil { editingName = false }
    }
}
