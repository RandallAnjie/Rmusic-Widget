import SwiftUI

struct RMusicRootView: View {
    @Environment(RMusicAppModel.self) private var model
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        @Bindable var model = model

        ZStack {
            if horizontalSizeClass == .regular {
                regularLayout
            } else {
                compactLayout
            }

            if model.isNowPlayingPresented {
                NowPlayingPresentation(isPresented: $model.isNowPlayingPresented)
                    .zIndex(20)
                    .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(reduceMotion ? .easeOut(duration: 0.18) : RMusicTheme.responsiveSpring, value: model.isNowPlayingPresented)
        .rmusicBackground()
        .task { await model.start() }
        .onOpenURL { model.handleDeepLink($0) }
        .sheet(item: $model.catalogSheetRoute) { route in
            NavigationStack {
                CatalogDetailView(route: route)
            }
            .presentationDragIndicator(.visible)
        }
        .alert("RMusic", isPresented: Binding(
            get: { model.alertMessage != nil },
            set: { if !$0 { model.alertMessage = nil } }
        )) {
            Button("好", role: .cancel) { model.alertMessage = nil }
        } message: {
            Text(model.alertMessage ?? "")
        }
    }

    @ViewBuilder
    private var compactLayout: some View {
        if #available(iOS 26.1, *) {
            compactTabView
                .tabViewBottomAccessory(isEnabled: model.playback.currentTrack != nil) {
                    compactMiniPlayer
                }
        } else if #available(iOS 26.0, *) {
            if model.playback.currentTrack != nil {
                compactTabView
                    .tabViewBottomAccessory {
                        compactMiniPlayer
                    }
            } else {
                compactTabView
            }
        } else {
            compactTabView
        }
    }

    private var compactTabView: some View {
        @Bindable var model = model

        return TabView(selection: $model.selectedTab) {
            compactTabNavigation(HomeView())
                .tabItem { Label(RMusicTab.home.title, systemImage: model.selectedTab == .home ? RMusicTab.home.selectedSymbol : RMusicTab.home.symbol) }
                .tag(RMusicTab.home)

            compactTabNavigation(SearchView())
                .tabItem { Label(RMusicTab.search.title, systemImage: model.selectedTab == .search ? RMusicTab.search.selectedSymbol : RMusicTab.search.symbol) }
                .tag(RMusicTab.search)

            compactTabNavigation(LibraryView())
                .tabItem { Label(RMusicTab.library.title, systemImage: model.selectedTab == .library ? RMusicTab.library.selectedSymbol : RMusicTab.library.symbol) }
                .tag(RMusicTab.library)

            compactTabNavigation(AccountView())
                .tabItem { Label(RMusicTab.account.title, systemImage: model.selectedTab == .account ? RMusicTab.account.selectedSymbol : RMusicTab.account.symbol) }
                .tag(RMusicTab.account)
        }
        .tint(RMusicTheme.accent)
        .toolbarBackground(.ultraThinMaterial, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
    }

    private var regularLayout: some View {
        @Bindable var model = model

        return NavigationSplitView {
            VStack(spacing: 12) {
                HStack(spacing: 12) {
                    BrandMark(size: 42)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("RMusic")
                            .font(.title3.weight(.bold))
                        Text("想听的，现在就响起")
                            .font(.caption)
                            .foregroundStyle(RMusicTheme.textSecondary)
                    }
                    Spacer()
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 16)

                List(RMusicTab.allCases) { tab in
                    Button {
                        model.selectedTab = tab
                    } label: {
                        Label(tab.title, systemImage: model.selectedTab == tab ? tab.selectedSymbol : tab.symbol)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(model.selectedTab == tab ? RMusicTheme.accent : RMusicTheme.textPrimary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(model.selectedTab == tab ? RMusicTheme.accent.opacity(0.12) : Color.clear)
                }
                .listStyle(.sidebar)
            }
            .background(.ultraThinMaterial)
            .navigationSplitViewColumnWidth(min: 220, ideal: 250, max: 290)
        } detail: {
            tabNavigation(selectedView)
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    compactMiniPlayer
                        .padding(.horizontal, 12)
                        .padding(.bottom, 8)
                }
        }
        .navigationSplitViewStyle(.balanced)
        .tint(RMusicTheme.accent)
    }

    @ViewBuilder
    private var selectedView: some View {
        switch model.selectedTab {
        case .home: HomeView()
        case .search: SearchView()
        case .library: LibraryView()
        case .account: AccountView()
        }
    }

    private func tabNavigation<Content: View>(_ content: Content) -> some View {
        NavigationStack {
            content
                .navigationDestination(for: CatalogRoute.self) { route in
                    CatalogDetailView(route: route)
                }
        }
        .tint(RMusicTheme.accent)
    }

    @ViewBuilder
    private func compactTabNavigation<Content: View>(_ content: Content) -> some View {
        if #available(iOS 26.0, *) {
            tabNavigation(content)
        } else {
            tabNavigation(content)
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    compactMiniPlayer
                }
        }
    }

    @ViewBuilder
    private var compactMiniPlayer: some View {
        if model.playback.currentTrack != nil {
            MiniPlayerView {
                model.isNowPlayingPresented = true
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 2)
            .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
            .accessibilitySortPriority(1)
        }
    }
}

private struct NowPlayingPresentation: View {
    @Binding var isPresented: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dragOffset: CGFloat = 0

    var body: some View {
        GeometryReader { proxy in
            NowPlayingView(onDismiss: dismiss)
                .frame(width: proxy.size.width, height: proxy.size.height)
                .offset(y: dragOffset)
                .scaleEffect(1 - min(dragOffset / max(proxy.size.height, 1), 1) * 0.035)
                .gesture(dismissGesture(height: proxy.size.height))
                .ignoresSafeArea()
        }
        .background(Color.black.opacity(0.34 * (1 - min(dragOffset / 600, 1))).ignoresSafeArea())
    }

    private func dismissGesture(height: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 8, coordinateSpace: .global)
            .onChanged { value in
                let translation = value.translation.height
                dragOffset = translation >= 0 ? translation : rubberBand(translation)
            }
            .onEnded { value in
                let projected = value.predictedEndTranslation.height
                if dragOffset > height * 0.22 || projected > height * 0.42 {
                    RMusicHaptics.impact(.light)
                    withAnimation(reduceMotion ? .easeOut(duration: 0.16) : RMusicTheme.momentumSpring) {
                        dragOffset = height
                    } completion: {
                        isPresented = false
                        dragOffset = 0
                    }
                } else {
                    withAnimation(reduceMotion ? .easeOut(duration: 0.16) : RMusicTheme.momentumSpring) {
                        dragOffset = 0
                    }
                }
            }
    }

    private func rubberBand(_ value: CGFloat) -> CGFloat {
        let magnitude = abs(value)
        return -(magnitude * 180 * 0.55) / (180 + 0.55 * magnitude)
    }

    private func dismiss() {
        RMusicHaptics.impact(.light)
        isPresented = false
    }
}
