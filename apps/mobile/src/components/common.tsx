import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  LayoutAnimation,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  UIManager,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import { indexToTab, tabToIndex } from '../app/constants';
import { groupSecondaryPages } from '../app/navigation';
import {
  MACHINE_VIEW_PAGES,
  getInitialServerCardExpanded,
  getMachinePagerPageWidth,
  getMachineViewPageIndex,
  getMachineViewPageView,
} from '../app/machineView';
import type { Server, ServerStatus, Task, TaskInfo, UnifiedReport } from '@pmeow/app-common';
import type { NotificationInboxItem } from '../lib/notification-inbox';
import {
  formatNotificationKind,
  formatPercent,
  formatQueueTaskStatus,
  formatTaskStatus,
  formatTimestamp,
} from '../app/formatters';
import { computeGpuIdleStatus, getGpuIdlePalette, getUsagePalette } from '../app/metrics';
import { styles } from '../app/styles';
import { ServerCardVisuals } from './monitoring';

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

const PullToRefreshContext = createContext<{
  refreshing: boolean;
  onRefresh: () => Promise<void>;
} | null>(null);

export function RefreshableScrollView(props: ScrollViewProps & { children: ReactNode }) {
  const refreshContext = useContext(PullToRefreshContext);
  const { children, ...scrollProps } = props;

  return (
    <ScrollView
      {...scrollProps}
      refreshControl={refreshContext ? (
        <RefreshControl
          refreshing={refreshContext.refreshing}
          onRefresh={() => void refreshContext.onRefresh()}
          tintColor="#86d5ff"
          colors={['#86d5ff']}
          progressBackgroundColor="#0d1d2c"
        />
      ) : undefined}
    >
      {children}
    </ScrollView>
  );
}

export function SectionCard(props: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{props.title}</Text>
      {props.description ? <Text style={styles.cardDescription}>{props.description}</Text> : null}
      {props.children}
    </View>
  );
}

export function PageSection(props: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.pageSection}>
      <Text style={styles.pageSectionTitle}>{props.title}</Text>
      {props.description ? <Text style={styles.pageSectionDescription}>{props.description}</Text> : null}
      {props.children}
    </View>
  );
}

export function StatBlock(props: { label: string; value: string | number; usagePercent?: number }) {
  const palette = props.usagePercent == null ? null : getUsagePalette(props.usagePercent);

  return (
    <View
      style={[
        styles.summaryBlock,
        palette ? { borderColor: palette.borderColor, backgroundColor: palette.backgroundColor } : null,
      ]}
    >
      <Text style={[styles.summaryValue, palette ? { color: palette.textColor } : null]}>{props.value}</Text>
      <Text style={styles.summaryLabel}>{props.label}</Text>
    </View>
  );
}

export function SecondaryPageTabs<T extends string>(props: {
  pages: Array<{ id: T; label: string }>;
  activePage: T;
  onChangePage: (page: T) => void;
  tabMinWidth?: number;
  pageIndexOffset?: number;
  scrollProgress?: Animated.Value;
}) {
  const indicatorProgress = useRef(new Animated.Value(0)).current;
  const [containerWidth, setContainerWidth] = useState(0);
  const activeIndex = Math.max(0, props.pages.findIndex((page) => page.id === props.activePage));
  const pageIndexOffset = props.pageIndexOffset ?? 0;
  const tabGap = 8;
  const horizontalPadding = 4;
  const fixedTabWidth = props.tabMinWidth;
  const innerWidth = fixedTabWidth
    ? props.pages.length * fixedTabWidth + (props.pages.length - 1) * tabGap + horizontalPadding * 2
    : containerWidth;
  const tabWidth = fixedTabWidth
    ?? Math.max(1, (Math.max(1, containerWidth) - horizontalPadding * 2 - tabGap * (props.pages.length - 1)) / props.pages.length);
  const indicatorWidth = Math.max(1, tabWidth);

  useEffect(() => {
    if (!props.scrollProgress) {
      Animated.timing(indicatorProgress, {
        toValue: activeIndex,
        duration: 180,
        useNativeDriver: true,
      }).start();
    }
  }, [activeIndex, indicatorProgress, props.scrollProgress]);

  const progress = props.scrollProgress ?? indicatorProgress;
  const pageInputRange = props.pages.map((_, index) => pageIndexOffset + index);
  const tabOutputRange = props.pages.map((_, index) => horizontalPadding + (tabWidth + tabGap) * index);
  const inputRange = pageInputRange.length > 1 ? pageInputRange : [0, 1];
  const outputRange = tabOutputRange.length > 1 ? tabOutputRange : [horizontalPadding, horizontalPadding];

  const tabs = (
    <View
      style={[styles.secondaryPageTabs, fixedTabWidth ? { width: innerWidth } : null]}
      onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.secondaryPageTabIndicator,
          {
            width: indicatorWidth,
            transform: [
              {
                translateX: progress.interpolate({
                  inputRange,
                  outputRange,
                  extrapolate: 'clamp',
                }),
              },
            ],
          },
        ]}
      />
      {props.pages.map((page) => {
        const active = page.id === props.activePage;
        return (
          <Pressable
            key={page.id}
            style={[styles.secondaryPageTab, { width: tabWidth }]}
            onPress={() => props.onChangePage(page.id)}
          >
            <Text style={[styles.secondaryPageTabText, active ? styles.secondaryPageTabTextActive : null]}>{page.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  if (fixedTabWidth) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.secondaryPageTabsScroll}>
        {tabs}
      </ScrollView>
    );
  }

  return tabs;
}

export function SecondarySwipeView<T extends string>(props: {
  pages: Array<{ id: T; label: string }>;
  activePage: T;
  onChangePage: (page: T) => void;
  renderPage: (page: T) => ReactNode;
  tabMinWidth?: number;
  tabBlockSize?: number;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const tabBlockScrollRef = useRef<ScrollView>(null);
  const currentTabBlockIndexRef = useRef(0);
  const pageProgress = useRef(new Animated.Value(0)).current;
  const tabBlockProgress = useRef(new Animated.Value(0)).current;
  const [measuredWidth, setMeasuredWidth] = useState<number | undefined>();
  const { width } = useWindowDimensions();
  const pageWidth = getMachinePagerPageWidth(measuredWidth, width - 40);
  const activeIndex = Math.max(0, props.pages.findIndex((page) => page.id === props.activePage));
  const tabBlocks = useMemo(
    () => (props.tabBlockSize ? groupSecondaryPages(props.pages, props.tabBlockSize) : null),
    [props.pages, props.tabBlockSize],
  );
  const tabBlockStarts = tabBlocks?.map((block) => props.pages.findIndex((page) => page.id === block[0].id)) ?? [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ x: activeIndex * pageWidth, animated: true });
  }, [activeIndex, pageWidth]);

  useEffect(() => {
    if (!tabBlocks) {
      return;
    }

    const nextBlockIndex = tabBlocks.findIndex((block) => block.some((page) => page.id === props.activePage));
    if (nextBlockIndex < 0 || nextBlockIndex === currentTabBlockIndexRef.current) {
      return;
    }

    currentTabBlockIndexRef.current = nextBlockIndex;
    tabBlockScrollRef.current?.scrollTo({ x: nextBlockIndex * pageWidth, animated: true });
    Animated.timing(tabBlockProgress, {
      toValue: nextBlockIndex,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [activeIndex, pageWidth, props.activePage, tabBlockProgress, tabBlocks]);

  const handleMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.max(0, Math.min(props.pages.length - 1, Math.round(event.nativeEvent.contentOffset.x / pageWidth)));
    props.onChangePage(props.pages[nextIndex].id);
  };

  const handleContentScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    pageProgress.setValue(event.nativeEvent.contentOffset.x / pageWidth);
  };

  const handleTabBlockMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!tabBlocks) {
      return;
    }
    const nextIndex = Math.max(0, Math.min(tabBlocks.length - 1, Math.round(event.nativeEvent.contentOffset.x / pageWidth)));
    currentTabBlockIndexRef.current = nextIndex;
    tabBlockProgress.setValue(nextIndex);
  };

  const tabs = tabBlocks ? (
    <View style={styles.secondaryTabBlockWrap}>
      <ScrollView
        ref={tabBlockScrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={[styles.secondaryTabBlockPager, { width: pageWidth }]}
        onScroll={(event) => tabBlockProgress.setValue(event.nativeEvent.contentOffset.x / pageWidth)}
        onMomentumScrollEnd={handleTabBlockMomentumEnd}
        scrollEventThrottle={16}
      >
        {tabBlocks.map((block, blockIndex) => (
          <View key={block.map((page) => page.id).join('-')} style={{ width: pageWidth }}>
            <SecondaryPageTabs
              pages={block}
              activePage={props.activePage}
              onChangePage={props.onChangePage}
              pageIndexOffset={tabBlockStarts[blockIndex] ?? 0}
              scrollProgress={pageProgress}
            />
          </View>
        ))}
      </ScrollView>
      <View style={styles.secondaryTabBlockIndicatorRow}>
        {tabBlocks.map((block, blockIndex) => {
          const inputRange = tabBlocks.map((_, index) => index);
          const widthRange = tabBlocks.map((_, index) => (index === blockIndex ? 20 : 6));
          const opacityRange = tabBlocks.map((_, index) => (index === blockIndex ? 1 : 0.45));
          return (
            <Animated.View
              key={block.map((page) => page.id).join('-indicator')}
              style={[
                styles.secondaryTabBlockIndicator,
                {
                  width: tabBlockProgress.interpolate({
                    inputRange,
                    outputRange: widthRange,
                    extrapolate: 'clamp',
                  }),
                  opacity: tabBlockProgress.interpolate({
                    inputRange,
                    outputRange: opacityRange,
                    extrapolate: 'clamp',
                  }),
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  ) : (
    <SecondaryPageTabs
      pages={props.pages}
      activePage={props.activePage}
      onChangePage={props.onChangePage}
      tabMinWidth={props.tabMinWidth}
      scrollProgress={pageProgress}
    />
  );

  return (
    <View style={styles.secondarySwipeWrap} onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}>
      {tabs}
      <ScrollView
        ref={scrollRef}
        style={[styles.secondarySwipePagerClip, { width: pageWidth }]}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleContentScroll}
        onMomentumScrollEnd={handleMomentumEnd}
        scrollEventThrottle={16}
      >
        {props.pages.map((page) => (
          <View key={page.id} style={[styles.secondarySwipePage, { width: pageWidth }]}>
            {props.renderPage(page.id)}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

export function ServerCard(props: {
  server: Server;
  status?: ServerStatus;
  report?: UnifiedReport;
  onPress?: () => void;
}) {
  const [expanded, setExpanded] = useState(getInitialServerCardExpanded);
  const [contentMounted, setContentMounted] = useState(expanded);
  const expansionProgress = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  const connStatus = props.status?.status ?? 'offline';
  const runningCount = props.report?.taskQueue.running.length ?? 0;
  const queuedCount = props.report?.taskQueue.queued.length ?? 0;
  const cpuPalette = getUsagePalette(props.report?.resourceSnapshot.cpu.usagePercent);
  const memoryPalette = getUsagePalette(props.report?.resourceSnapshot.memory.usagePercent);

  const toggleExpanded = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (expanded) {
      setExpanded(false);
      Animated.timing(expansionProgress, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setContentMounted(false);
        }
      });
      return;
    }

    setContentMounted(true);
    setExpanded(true);
    Animated.timing(expansionProgress, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  };

  return (
    <View style={styles.serverCard}>
      <Pressable onPress={toggleExpanded}>
        <View style={styles.serverHeader}>
          <Text style={styles.serverTitle}>{props.server.name}</Text>
          <View style={[styles.statusBadge, connStatus === 'online' ? styles.statusOnline : styles.statusOffline]}>
            <Text style={styles.statusBadgeText}>{connStatus === 'online' ? '在线' : '离线'}</Text>
          </View>
        </View>
        <Text style={styles.serverMeta}>Agent {props.server.agentId.slice(0, 8)} · 最近上报 {formatTimestamp(props.status?.lastSeenAt ?? null)}</Text>
        <Text style={styles.serverExpandHint}>{expanded ? '收起摘要' : '点按展开状态摘要'}</Text>
      </Pressable>
      {contentMounted ? (
        <Animated.View
          style={[
            styles.serverExpandedContent,
            {
              opacity: expansionProgress,
              transform: [
                {
                  translateY: expansionProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-8, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.metricRow}>
            <Text style={[styles.metricItem, { color: cpuPalette.textColor, borderColor: cpuPalette.borderColor, backgroundColor: cpuPalette.backgroundColor }]}>CPU {formatPercent(props.report?.resourceSnapshot.cpu.usagePercent)}</Text>
            <Text style={[styles.metricItem, { color: memoryPalette.textColor, borderColor: memoryPalette.borderColor, backgroundColor: memoryPalette.backgroundColor }]}>内存 {formatPercent(props.report?.resourceSnapshot.memory.usagePercent)}</Text>
            <Text style={styles.metricItem}>运行 {runningCount}</Text>
            <Text style={styles.metricItem}>排队 {queuedCount}</Text>
          </View>
          <ServerCardVisuals report={props.report} />
          {props.onPress ? (
            <Pressable style={styles.serverDetailLink} onPress={props.onPress}>
              <Text style={styles.serverDetailLinkText}>查看详情</Text>
            </Pressable>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

export function MachineViewPager(props: {
  view: 'summary' | 'gpuIdle';
  onChangeView: (view: 'summary' | 'gpuIdle') => void;
  servers: Server[];
  statuses: Record<string, ServerStatus>;
  latestMetrics: Record<string, UnifiedReport>;
  emptyText: string;
  onSelectServer: (serverId: string) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const pageProgress = useRef(new Animated.Value(getMachineViewPageIndex(props.view))).current;
  const [measuredWidth, setMeasuredWidth] = useState<number | undefined>();
  const { width } = useWindowDimensions();
  const pageWidth = getMachinePagerPageWidth(measuredWidth, width - 40);
  const activeIndex = getMachineViewPageIndex(props.view);

  useEffect(() => {
    scrollRef.current?.scrollTo({ x: activeIndex * pageWidth, animated: true });
  }, [activeIndex, pageWidth]);

  useEffect(() => {
    Animated.timing(pageProgress, {
      toValue: activeIndex,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, pageProgress]);

  const handleLayout = (event: LayoutChangeEvent) => {
    setMeasuredWidth(event.nativeEvent.layout.width);
  };

  const handleMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
    props.onChangeView(getMachineViewPageView(nextIndex));
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    pageProgress.setValue(event.nativeEvent.contentOffset.x / pageWidth);
  };

  return (
    <View style={styles.machineViewWrap} onLayout={handleLayout}>
      <SecondaryPageTabs
        pages={MACHINE_VIEW_PAGES.map((page) => ({ id: page.view, label: page.label }))}
        activePage={props.view}
        onChangePage={props.onChangeView}
        scrollProgress={pageProgress}
      />
      <ScrollView
        ref={scrollRef}
        style={[styles.machineViewPagerClip, { width: pageWidth }]}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        onMomentumScrollEnd={handleMomentumEnd}
        scrollEventThrottle={16}
      >
        <View style={[styles.machineViewPage, { width: pageWidth }]}>
          {props.servers.length === 0 ? (
            <Text style={styles.emptyText}>{props.emptyText}</Text>
          ) : (
            props.servers.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                status={props.statuses[server.id]}
                report={props.latestMetrics[server.id]}
                onPress={() => props.onSelectServer(server.id)}
              />
            ))
          )}
        </View>
        <View style={[styles.machineViewPage, { width: pageWidth }]}>
          {props.servers.length === 0 ? (
            <Text style={styles.emptyText}>{props.emptyText}</Text>
          ) : (
            <View style={styles.gpuIdleSection}>
              {props.servers.map((server) => (
                <GpuIdleBar
                  key={server.id}
                  server={server}
                  report={props.latestMetrics[server.id]}
                  onPress={() => props.onSelectServer(server.id)}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

export function TaskRow(props: {
  task: Task;
  pending: boolean;
  onPress?: () => void;
  onCancel?: () => void;
}) {
  const cancellable = props.task.status === 'queued' || props.task.status === 'running';

  return (
    <View style={styles.eventRow}>
      <View style={styles.rowHeader}>
        <Pressable style={styles.taskRowMain} onPress={props.onPress} disabled={!props.onPress}>
          <Text style={styles.eventTitle}>{formatTaskStatus(props.task.status)} · {props.task.command}</Text>
          <Text style={styles.eventMeta}>{props.task.serverId} · {props.task.user} · {formatTimestamp(props.task.createdAt)}</Text>
        </Pressable>
        {cancellable && props.onCancel ? (
          <Pressable
            style={[styles.inlineActionButton, props.pending ? styles.buttonDisabled : null]}
            disabled={props.pending}
            onPress={props.onCancel}
          >
            <Text style={styles.inlineActionButtonText}>{props.pending ? '处理中...' : '取消'}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function QueueTaskRow(props: { task: TaskInfo; onPress?: () => void }) {
  const requestedVramText = formatTaskRequestedVram(props.task);

  return (
    <Pressable style={styles.eventRowCard} disabled={!props.onPress} onPress={props.onPress}>
      <Text style={styles.eventTitle}>{formatQueueTaskStatus(props.task.status)} · {props.task.command}</Text>
      <Text style={styles.eventMeta}>{props.task.user} · VRAM {requestedVramText} · {formatTimestamp(props.task.createdAt)}</Text>
    </Pressable>
  );
}

function formatTaskRequestedVram(task: Pick<TaskInfo, 'requireVramMb' | 'requestedVramMb' | 'vramMode'>): string {
  const mode = task.vramMode;
  const requested = task.requestedVramMb ?? (mode === 'exclusive_auto' ? null : task.requireVramMb);
  if (mode === 'exclusive_auto') {
    return '独占（自动观察）';
  }
  if (requested === 0) {
    return '0 MB（共享 / 不预留）';
  }
  return `${requested ?? 0} MB（共享）`;
}

export function ExpandableList(props: {
  totalCount: number;
  initialVisibleCount: number;
  renderItems: (expanded: boolean) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const hiddenCount = Math.max(0, props.totalCount - props.initialVisibleCount);

  return (
    <>
      {props.renderItems(expanded)}
      {hiddenCount > 0 ? (
        <View style={styles.listFooter}>
          <Text style={styles.listFooterMeta}>
            {expanded ? `已显示全部 ${props.totalCount} 条` : `已显示 ${props.initialVisibleCount} / ${props.totalCount} 条`}
          </Text>
          <Pressable style={styles.inlineActionButton} onPress={() => setExpanded((current) => !current)}>
            <Text style={styles.inlineActionButtonText}>{expanded ? '收起' : `查看更多 ${hiddenCount} 条`}</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

export function NotificationInboxSection(props: { items: NotificationInboxItem[]; initialVisibleCount?: number }) {
  const initialVisibleCount = props.initialVisibleCount ?? 8;

  return (
    <PageSection title="通知记录" description="仅展示本机真正发送过的系统通知。">
      {props.items.length === 0 ? (
        <Text style={styles.emptyText}>当前还没有本地通知记录。</Text>
      ) : (
        <ExpandableList
          totalCount={props.items.length}
          initialVisibleCount={initialVisibleCount}
          renderItems={(expanded) => {
            const visibleItems = expanded ? props.items : props.items.slice(0, initialVisibleCount);

            return visibleItems.map((item) => (
              <View key={item.id} style={styles.eventRow}>
                <Text style={styles.eventTitle}>{formatNotificationKind(item.kind)} · {item.title}</Text>
                <Text style={styles.eventMeta}>{item.body} · {formatTimestamp(item.timestamp)}</Text>
              </View>
            ));
          }}
        />
      )}
    </PageSection>
  );
}

export function BottomTabs<T extends string>(props: {
  tabs: Array<{ id: T; label: string }>;
  activeTab: T;
  onChangeTab: (tab: T) => void;
}) {
  return (
    <View style={styles.bottomTabs}>
      {props.tabs.map((tab) => {
        const active = tab.id === props.activeTab;
        return (
          <Pressable
            key={tab.id}
            style={[styles.bottomTab, active ? styles.bottomTabActive : null]}
            onPress={() => props.onChangeTab(tab.id)}
          >
            <Text style={[styles.bottomTabText, active ? styles.bottomTabTextActive : null]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SwipeTabView<T extends string>(props: {
  tabs: Array<{ id: T; label: string }>;
  activeTab: T;
  onChangeTab: (tab: T) => void;
  renderScene: (tab: T) => ReactNode;
}) {
  const pagerRef = useRef<PagerView>(null);
  const lastKnownPageRef = useRef(tabToIndex(props.tabs, props.activeTab));
  const isProgrammaticRef = useRef(false);

  const targetIndex = tabToIndex(props.tabs, props.activeTab);

  useEffect(() => {
    if (lastKnownPageRef.current !== targetIndex && pagerRef.current) {
      lastKnownPageRef.current = targetIndex;
      isProgrammaticRef.current = true;
      pagerRef.current.setPage(targetIndex);
    }
  }, [targetIndex]);

  return (
    <PagerView
      ref={pagerRef}
      style={{ flex: 1 }}
      initialPage={targetIndex}
      onPageSelected={(e) => {
        const position = e.nativeEvent.position;
        lastKnownPageRef.current = position;
        if (isProgrammaticRef.current) {
          isProgrammaticRef.current = false;
          return;
        }
        props.onChangeTab(indexToTab(props.tabs, position));
      }}
    >
      {props.tabs.map((tab) => (
        <View key={tab.id} style={{ flex: 1 }}>
          {props.renderScene(tab.id)}
        </View>
      ))}
    </PagerView>
  );
}

export function GpuIdleBar(props: {
  server: Server;
  report?: UnifiedReport;
  onPress?: () => void;
}) {
  const gpuCards = props.report?.resourceSnapshot.gpuCards ?? [];
  if (gpuCards.length === 0) {
    return null;
  }

  const status = computeGpuIdleStatus(gpuCards);
  const palette = getGpuIdlePalette(status.idlePercent);

  return (
    <Pressable
      style={[styles.gpuIdleBar, { borderColor: palette.borderColor, backgroundColor: palette.backgroundColor }]}
      onPress={props.onPress}
    >
      <Text style={styles.gpuIdleBarName}>{props.server.name}</Text>
      <Text style={[styles.gpuIdleBarValue, { color: palette.textColor }]}>[{status.idleCount}/{status.totalCount}] 空闲</Text>
    </Pressable>
  );
}

export function AuthenticatedShell(props: {
  title: string;
  subtitle: string;
  identityLabel?: string;
  compact?: boolean;
  error: string | null;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  children: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <PullToRefreshContext.Provider value={{ refreshing: props.refreshing, onRefresh: props.onRefresh }}>
      <View style={styles.shell}>
        {props.compact ? (
          <>
            <View style={styles.compactHeaderRow}>
              <Text style={styles.compactHeaderLabel}>{props.identityLabel ?? props.subtitle}</Text>
            </View>
            {props.error ? (
              <View style={styles.compactHeaderRow}>
                <Text style={styles.errorText}>{props.error}</Text>
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.shellHeader}>
            <View style={styles.heroCompact}>
              <Text style={styles.kicker}>PMEOW MOBILE</Text>
              <Text style={styles.shellTitle}>{props.title}</Text>
              <Text style={styles.shellSubtitle}>{props.subtitle}</Text>
              {props.error ? <Text style={styles.errorText}>{props.error}</Text> : null}
            </View>
          </View>
        )}
        <View style={styles.screenWrap}>{props.children}</View>
        {props.tabs}
      </View>
    </PullToRefreshContext.Provider>
  );
}
