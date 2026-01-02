class NippoApp {
    constructor() {
        this.tasks = [];
        this.currentTaskId = null;
        this.taskAddMode = 'now';
        this.currentTabId = 'default';
        this.reportUrls = [];
        this.toastTimer = null;
        this.originalReportContent = '';
        this.originalTabContents = new Map();
        this.hasUnsavedChanges = false;
        this.taskStock = [];
        this.goalStock = [];
        this.tagStock = [];
        this.tempGoalStock = [];
        this.tempTaskStock = [];
        this.tempTagStock = [];
        this.hasGoalStockChanges = false;
        this.hasTaskStockChanges = false;
        this.hasTagStockChanges = false;
        this.eventListenersInitialized = false;
        this.settings = {};
        this.currentMode = 'today';
        this.selectedDate = null;
        this.currentDate = null; // 統一された日付管理（null = 今日）
        this.historyDates = [];
        this.historyData = {}; // 履歴データの初期化
        this.lastKnownDate = null; // 日付変更検知用
        this._calendarLastInteractAt = 0;
        this._calendarValueBeforeInteract = '';
        this._suppressTodayClickUntil = 0;
        this._calendarInputWrap = null;
        this._timeTickInterval = null;
        this._dateTimeInterval = null;
        this._timeTickTimeout = null;
        this._dateTimeTimeout = null;
        this._supabase = null;
        this._accessToken = null;
        this._userId = null;
        this._fetchWrapped = false;
        this._dueReservationRefreshInFlight = false;
        this._dueReservationRefreshTimeout = null;
        this._webBootstrapped = false;
        this._realtimeChannel = null;
        this._realtimeRefreshTimer = null;
        this._realtimePendingTypes = new Set();
        this._realtimePendingKeys = new Set();
        this._viewportHeightCleanup = null;
        this.init();
    }

    // iOS Safari/PWA: キーボード表示時に100vhが縮まずヘッダーが見切れる問題の回避
    // visualViewport の実高さをCSS変数 --app-height に反映してレイアウト計算を安定させる
    setupViewportHeightFix() {
        try {
            const root = document.documentElement;
            if (!root || !root.style) return;

            const vv = window.visualViewport;
            const setViewportVars = () => {
                const height = vv?.height || window.innerHeight;
                const offsetTop = vv?.offsetTop || 0;
                // 端末回転やキーボード開閉直後の一瞬の0を避ける
                if (!height || height < 100) return;

                // body側で offsetTop を padding-top として消費するため
                // 高さは height + offsetTop にして「可視領域ぶん」を確保する
                const effectiveHeight = Math.round(height + offsetTop);
                root.style.setProperty('--app-height', `${effectiveHeight}px`);
                root.style.setProperty('--app-offset-top', `${Math.round(offsetTop)}px`);
            };

            // 初回
            setViewportVars();

            // 変化に追従（iOSのキーボード/URLバーの出入りは visualViewport が一番確実）
            const onResize = () => setViewportVars();
            const onScroll = () => setViewportVars();

            window.addEventListener('resize', onResize);
            window.addEventListener('orientationchange', onResize);
            document.addEventListener('focusin', onResize);
            document.addEventListener('focusout', () => setTimeout(setViewportVars, 50));

            if (vv) {
                vv.addEventListener('resize', onResize);
                vv.addEventListener('scroll', onScroll);
            }

            this._viewportHeightCleanup = () => {
                window.removeEventListener('resize', onResize);
                window.removeEventListener('orientationchange', onResize);
                document.removeEventListener('focusin', onResize);
                if (vv) {
                    vv.removeEventListener('resize', onResize);
                    vv.removeEventListener('scroll', onScroll);
                }
            };
        } catch (_e) {
            // no-op
        }
    }

    // 文字列の「今日(YYYY-MM-DD)」を Asia/Tokyo 基準で返す（iOSの日時/タイムゾーン差異対策）
    getTokyoTodayYmd() {
        const today = new Date();
        const parts = today.toLocaleDateString('ja-JP', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            timeZone: 'Asia/Tokyo'
        }).split('/');
        return `${parts[0]}-${parts[1]}-${parts[2]}`;
    }

    syncCalendarInputHint() {
        const wrap = this._calendarInputWrap || document.getElementById('date-input-wrap');
        const input = document.getElementById('calendar-date-input');
        if (!wrap || !input) return;
        wrap.classList.toggle('has-value', !!input.value);
    }

    isWebMode() {
        return true;
    }

    wrapFetchWithAuth() {
        if (!this.isWebMode()) return;
        if (this._fetchWrapped) return;
        if (typeof window.fetch !== 'function') return;

        const originalFetch = window.fetch.bind(window);
        window.fetch = (input, init = {}) => {
            try {
                const token = this._accessToken;
                if (!token) {
                    return originalFetch(input, init);
                }

                const addAuthHeader = (headers) => {
                    if (!headers) headers = {};
                    if (headers instanceof Headers) {
                        if (!headers.has('Authorization')) {
                            headers.set('Authorization', `Bearer ${token}`);
                        }
                        return headers;
                    }
                    const normalized = { ...headers };
                    if (!('Authorization' in normalized) && !('authorization' in normalized)) {
                        normalized.Authorization = `Bearer ${token}`;
                    }
                    return normalized;
                };

                // string URL or Request
                if (typeof input === 'string') {
                    // /api へのリクエストにだけ付与
                    const url = input;
                    const isApi = url.startsWith('/api/') || url.includes('/api/');
                    if (!isApi) return originalFetch(input, init);
                    return originalFetch(input, { ...init, headers: addAuthHeader(init.headers) });
                }

                if (input instanceof Request) {
                    const url = input.url || '';
                    const isApi = url.includes('/api/');
                    if (!isApi) return originalFetch(input, init);

                    const mergedHeaders = addAuthHeader(init.headers || input.headers);
                    const req = new Request(input, { ...init, headers: mergedHeaders });
                    return originalFetch(req);
                }

                return originalFetch(input, init);
            } catch (e) {
                return originalFetch(input, init);
            }
        };

        this._fetchWrapped = true;
    }

    async initSupabaseAuth() {
        if (!this.isWebMode()) return;

        const url = window.__SUPABASE__?.url;
        const anonKey = window.__SUPABASE__?.anonKey;
        if (!url || !anonKey || !window.supabase) {
            console.error('Supabase設定が不足しています。/env.js と @supabase/supabase-js の読み込みを確認してください');
            this.showToast('Supabase設定が不足しています', 'error');
            return;
        }

        this._supabase = window.supabase.createClient(url, anonKey);

        const authBar = document.getElementById('web-auth-bar');
        const statusEl = document.getElementById('web-auth-status');
        const loginBtn = document.getElementById('web-login-btn');
        const logoutBtn = document.getElementById('web-logout-btn');

        if (authBar) authBar.style.display = 'flex';

        const applySession = async (session) => {
            this._accessToken = session?.access_token || null;
            this._userId = session?.user?.id || null;
            this.wrapFetchWithAuth();

            const user = session?.user;
            const userMeta = user?.user_metadata || {};
            const email = user?.email || '';
            const nameCandidate =
                userMeta.full_name ||
                userMeta.name ||
                userMeta.user_name ||
                userMeta.preferred_username ||
                '';
            const emailLocal = typeof email === 'string' ? (email.split('@')[0] || '') : '';
            const label = (nameCandidate || emailLocal || 'ログイン中').toString();
            if (statusEl) statusEl.textContent = this._accessToken ? label : '未ログイン';
            if (loginBtn) loginBtn.style.display = this._accessToken ? 'none' : 'inline-flex';
            if (logoutBtn) logoutBtn.style.display = this._accessToken ? 'inline-flex' : 'none';

            if (this._accessToken && !this._webBootstrapped) {
                await this.bootstrapWeb();
            }

            if (!this._accessToken) {
                this._webBootstrapped = false;
                this.teardownRealtimeSync();
            }
        };

        const { data } = await this._supabase.auth.getSession();
        await applySession(data?.session);

        this._supabase.auth.onAuthStateChange(async (_event, session) => {
            await applySession(session);
        });

        if (loginBtn) {
            loginBtn.addEventListener('click', async () => {
                try {
                    const redirectTo = `${window.location.origin}/`;
                    const { error } = await this._supabase.auth.signInWithOAuth({
                        provider: 'google',
                        options: { redirectTo },
                    });
                    if (error) throw error;
                } catch (e) {
                    console.error('ログイン失敗:', e);
                    this.showToast('ログインに失敗しました', 'error');
                }
            });
        }

        if (logoutBtn) {
            logoutBtn.addEventListener('click', async () => {
                try {
                    await this._supabase.auth.signOut();
                    this._webBootstrapped = false;
                    this.teardownRealtimeSync();
                } catch (e) {
                    console.error('ログアウト失敗:', e);
                    this.showToast('ログアウトに失敗しました', 'error');
                }
            });
        }
    }

    async bootstrapWeb() {
        if (!this.isWebMode()) return;
        if (this._webBootstrapped) return;
        if (!this._accessToken) {
            this.showToast('Googleでログインしてください', 'warning');
            return;
        }

        this.apiBaseUrl = window.location.origin;

        console.log('APIサーバーの準備を待機中...');
        const isApiReady = await this.waitForAPI();
        if (!isApiReady) {
            this.showToast('APIに接続できません', 'error');
            return;
        }

        console.log('アプリ起動時のデータ読み込み開始...');
        await this.loadTasks();
        await this.loadHistoryDates();
        await this.loadGoalStock();
        await this.loadTaskStock();
        await this.loadTagStock();
        await this.checkAndFixTagIntegrity();
        this.updateTagDropdown();
        try {
            await this.loadSettings();
        } catch (error) {
            console.error('設定の読み込みに失敗しました:', error);
        }

        this._webBootstrapped = true;

        // 他端末更新を即時反映（Supabase Realtime）
        this.setupRealtimeSync();
    }

    isDialogOpen(dialogId) {
        const el = document.getElementById(dialogId);
        return !!el && el.classList.contains('show');
    }

    teardownRealtimeSync() {
        try {
            if (this._realtimeRefreshTimer) {
                clearTimeout(this._realtimeRefreshTimer);
                this._realtimeRefreshTimer = null;
            }
            this._realtimePendingTypes.clear();
            this._realtimePendingKeys.clear();

            if (this._realtimeChannel && this._supabase?.removeChannel) {
                this._supabase.removeChannel(this._realtimeChannel);
            }
        } catch (_e) {
            // no-op
        } finally {
            this._realtimeChannel = null;
        }
    }

    setupRealtimeSync() {
        if (!this.isWebMode()) return;
        if (!this._supabase) return;
        if (!this._accessToken || !this._userId) return;
        if (this._realtimeChannel) return;

        try {
            const channelName = `nippo_docs_${this._userId}`;
            this._realtimeChannel = this._supabase
                .channel(channelName)
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'nippo_docs',
                        filter: `user_id=eq.${this._userId}`,
                    },
                    (payload) => {
                        const row = payload?.new || payload?.old || {};
                        const docType = row.doc_type;
                        const docKey = row.doc_key;

                        // doc_type/doc_key が取れない場合は広めに再読み込み
                        this.scheduleRealtimeRefresh(docType || 'unknown', docKey || 'unknown');
                    }
                )
                .subscribe((status) => {
                    if (status === 'SUBSCRIBED') {
                        console.log('[realtime] subscribed');
                    }
                });
        } catch (e) {
            console.warn('[realtime] setup failed:', e);
        }
    }

    scheduleRealtimeRefresh(docType, docKey) {
        // 連続イベントをまとめる（スマホ→PCで一気に複数APIが走らないように）
        if (docType) this._realtimePendingTypes.add(String(docType));
        if (docKey) this._realtimePendingKeys.add(String(docKey));

        if (this._realtimeRefreshTimer) return;
        this._realtimeRefreshTimer = setTimeout(async () => {
            this._realtimeRefreshTimer = null;
            const types = Array.from(this._realtimePendingTypes);
            const keys = Array.from(this._realtimePendingKeys);
            this._realtimePendingTypes.clear();
            this._realtimePendingKeys.clear();

            await this.refreshFromServerRealtime(types, keys);
        }, 350);
    }

    async refreshFromServerRealtime(types, keys) {
        if (!this._webBootstrapped || !this._accessToken) return;

        // 変更が来たら、画面表示中のデータは基本的に追従させる
        const wantsTasks = types.includes('tasks') || types.includes('unknown');
        const wantsHistoryDates = types.includes('tasks');
        const wantsTagStock = types.includes('tag_stock') || types.includes('unknown');
        const wantsTaskStock = types.includes('task_stock') || types.includes('unknown');
        const wantsGoalStock = types.includes('goal_stock') || types.includes('unknown');
        const wantsSettings = types.includes('settings') || types.includes('report_urls') || types.includes('unknown');

        // 報告書や設定など、編集途中の上書きを避けたいものは控えめに
        const reportOpen = this.isDialogOpen('report-dialog');
        const settingsOpen = this.isDialogOpen('settings-dialog');
        const editOpen = this.isDialogOpen('edit-dialog');

        if (editOpen) {
            // 編集モーダルが開いている間に tasks が動くと混乱しやすいので、トーストだけ出す
            if (wantsTasks) this.showToast('他端末で更新されました（編集後に再読込されます）');
            return;
        }

        try {
            if (wantsHistoryDates) {
                await this.loadHistoryDates();
            }

            // タスク（タイムライン）
            if (wantsTasks) {
                if (this.currentMode === 'today') {
                    await this.loadTasks();
                } else if (this.currentMode === 'history' && this.currentDate) {
                    // 更新された日付が現在表示中の履歴と一致しないなら、表示は維持しつつ日付一覧だけ更新
                    const shouldReload = keys.includes(this.currentDate) || keys.includes('unknown');
                    if (shouldReload) {
                        await this.loadHistoryData(this.currentDate);
                    }
                }
            }

            // ストック/タグ/目標
            if (wantsGoalStock && !this.hasGoalStockChanges) {
                await this.loadGoalStock();
            }
            if (wantsTaskStock && !this.hasTaskStockChanges) {
                await this.loadTaskStock();
            }
            if (wantsTagStock && !this.hasTagStockChanges) {
                await this.loadTagStock();
                await this.checkAndFixTagIntegrity();
                this.updateTagDropdown();
            }

            // 設定/報告先（開いている時は上書きしない）
            if (wantsSettings) {
                if (settingsOpen) {
                    this.showToast('他端末で設定が更新されました（閉じた後に反映されます）');
                } else {
                    await this.loadSettings();
                }

                if (reportOpen) {
                    this.showToast('他端末で報告先が更新されました');
                } else {
                    // reportUrls は報告書作成/設定の双方で使うため、閉じていても更新しておく
                    await this.loadReportUrls();
                }
            }
        } catch (e) {
            console.warn('[realtime] refresh failed:', e);
        }
    }

    isReservedTask(task) {
        return !!task && task.status === 'reserved';
    }

    isRunningTask(task) {
        return !!task && !task.endTime && !this.isReservedTask(task);
    }

    // アプリ初期化部分の終わりにドラッグ&ドロップ機能を初期化
    initDragAndDrop() {
        this.initGoalStockDragDrop();
        this.initTaskStockDragDrop();
        this.initTagStockDragDrop();
    }

    // 目標ストックのドラッグ&ドロップ
    initGoalStockDragDrop() {
        const list = document.getElementById('goal-stock-list');
        if (!list) return;

        let draggedElement = null;
        let draggedIndex = null;

        list.addEventListener('dragstart', (e) => {
            if (e.target.closest('.goal-stock-item')) {
                draggedElement = e.target.closest('.goal-stock-item');
                draggedIndex = parseInt(draggedElement.getAttribute('data-index'));
                e.dataTransfer.effectAllowed = 'move';
                draggedElement.style.opacity = '0.5';
            }
        });

        list.addEventListener('dragend', (e) => {
            if (draggedElement) {
                draggedElement.style.opacity = '1';
                // ドラッグオーバー効果をクリア
                list.querySelectorAll('.goal-stock-item').forEach(item => {
                    item.classList.remove('drag-over');
                });
                draggedElement = null;
                draggedIndex = null;
            }
        });

        list.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            // ドラッグオーバー時の視覚的フィードバック
            if (draggedElement) {
                const dropTarget = e.target.closest('.goal-stock-item');
                // 既存のhover効果を削除
                list.querySelectorAll('.goal-stock-item').forEach(item => {
                    item.classList.remove('drag-over');
                });
                // 現在の要素にhover効果を追加（自分自身以外）
                if (dropTarget && dropTarget !== draggedElement) {
                    dropTarget.classList.add('drag-over');
                }
            }
        });

        list.addEventListener('drop', (e) => {
            e.preventDefault();
            if (!draggedElement || draggedIndex === null) return;
            
            // ドロップ位置を計算
            const dropTarget = e.target.closest('.goal-stock-item');
            let dropIndex;
            
            if (dropTarget) {
                dropIndex = parseInt(dropTarget.getAttribute('data-index'));
            } else {
                // リスト内の他の場所にドロップされた場合、最も近い位置を計算
                const rect = list.getBoundingClientRect();
                const y = e.clientY - rect.top;
                const items = Array.from(list.children);
                
                for (let i = 0; i < items.length; i++) {
                    const itemRect = items[i].getBoundingClientRect();
                    const itemY = itemRect.top - rect.top + itemRect.height / 2;
                    if (y < itemY) {
                        dropIndex = i;
                        break;
                    }
                }
                if (dropIndex === undefined) dropIndex = items.length - 1;
            }
            
            // 同じ位置の場合は何もしない
            if (dropIndex === draggedIndex) return;
            
            // 配列の要素を移動
            const item = this.tempGoalStock.splice(draggedIndex, 1)[0];
            this.tempGoalStock.splice(dropIndex, 0, item);
            
            // 変更を反映するフラグを設定（再描画より前に設定）
            this.hasGoalStockChanges = true;
            
            // 再描画
            this.renderGoalStock();
            
            // ドラッグ&ドロップを再初期化（要素が再作成されるため）
            setTimeout(() => this.initGoalStockDragDrop(), 10);
        });
    }

    // タスクストックのドラッグ&ドロップ
    initTaskStockDragDrop() {
        const list = document.getElementById('task-stock-list');
        if (!list) return;

        let draggedElement = null;
        let draggedIndex = null;

        list.addEventListener('dragstart', (e) => {
            if (e.target.closest('.task-stock-item')) {
                draggedElement = e.target.closest('.task-stock-item');
                draggedIndex = parseInt(draggedElement.getAttribute('data-index'));
                e.dataTransfer.effectAllowed = 'move';
                draggedElement.style.opacity = '0.5';
            }
        });

        list.addEventListener('dragend', (e) => {
            if (draggedElement) {
                draggedElement.style.opacity = '1';
                // ドラッグオーバー効果をクリア
                list.querySelectorAll('.task-stock-item').forEach(item => {
                    item.classList.remove('drag-over');
                });
                draggedElement = null;
                draggedIndex = null;
            }
        });

        list.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            // ドラッグオーバー時の視覚的フィードバック
            if (draggedElement) {
                const dropTarget = e.target.closest('.task-stock-item');
                // 既存のhover効果を削除
                list.querySelectorAll('.task-stock-item').forEach(item => {
                    item.classList.remove('drag-over');
                });
                // 現在の要素にhover効果を追加（自分自身以外）
                if (dropTarget && dropTarget !== draggedElement) {
                    dropTarget.classList.add('drag-over');
                }
            }
        });

        list.addEventListener('drop', (e) => {
            e.preventDefault();
            if (!draggedElement || draggedIndex === null) return;
            
            // ドロップ位置を計算
            const dropTarget = e.target.closest('.task-stock-item');
            let dropIndex;
            
            if (dropTarget) {
                dropIndex = parseInt(dropTarget.getAttribute('data-index'));
            } else {
                // リスト内の他の場所にドロップされた場合、最も近い位置を計算
                const rect = list.getBoundingClientRect();
                const y = e.clientY - rect.top;
                const items = Array.from(list.children);
                
                for (let i = 0; i < items.length; i++) {
                    const itemRect = items[i].getBoundingClientRect();
                    const itemY = itemRect.top - rect.top + itemRect.height / 2;
                    if (y < itemY) {
                        dropIndex = i;
                        break;
                    }
                }
                if (dropIndex === undefined) dropIndex = items.length - 1;
            }
            
            // 同じ位置の場合は何もしない
            if (dropIndex === draggedIndex) return;
            
            // 配列の要素を移動
            const item = this.tempTaskStock.splice(draggedIndex, 1)[0];
            this.tempTaskStock.splice(dropIndex, 0, item);
            
            // 変更を反映するフラグを設定（再描画より前に設定）
            this.hasTaskStockChanges = true;
            
            // 再描画
            this.renderTaskStock();
            
            // ドラッグ&ドロップを再初期化（要素が再作成されるため）
            setTimeout(() => this.initTaskStockDragDrop(), 10);
        });
    }

    // タグストックのドラッグ&ドロップ
    initTagStockDragDrop() {
        const container = document.getElementById('tag-stock-list');
        if (!container) return;

        let draggedElement = null;
        let draggedIndex = null;

        container.addEventListener('dragstart', (e) => {
            if (e.target.closest('.stock-item')) {
                draggedElement = e.target.closest('.stock-item');
                draggedIndex = parseInt(draggedElement.getAttribute('data-index'));
                e.dataTransfer.effectAllowed = 'move';
                draggedElement.style.opacity = '0.5';
            }
        });

        container.addEventListener('dragend', (e) => {
            if (draggedElement) {
                draggedElement.style.opacity = '1';
                // ドラッグオーバー効果をクリア
                container.querySelectorAll('.stock-item').forEach(item => {
                    item.classList.remove('drag-over');
                });
                draggedElement = null;
                draggedIndex = null;
            }
        });

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            // ドラッグオーバー時の視覚的フィードバック
            if (draggedElement) {
                const dropTarget = e.target.closest('.stock-item');
                // 既存のhover効果を削除
                container.querySelectorAll('.stock-item').forEach(item => {
                    item.classList.remove('drag-over');
                });
                // 現在の要素にhover効果を追加（自分自身以外）
                if (dropTarget && dropTarget !== draggedElement) {
                    dropTarget.classList.add('drag-over');
                }
            }
        });

        container.addEventListener('drop', (e) => {
            e.preventDefault();
            console.log('タグストック drop イベント発生');
            console.log('draggedElement:', draggedElement);
            console.log('draggedIndex:', draggedIndex);
            
            if (!draggedElement || draggedIndex === null) {
                console.log('ドラッグ要素が無効のため処理をスキップ');
                return;
            }
            
            // ドロップ位置を計算
            const dropTarget = e.target.closest('.stock-item');
            let dropIndex;
            
            console.log('dropTarget:', dropTarget);
            
            if (dropTarget) {
                dropIndex = parseInt(dropTarget.getAttribute('data-index'));
                console.log('dropIndex (ターゲットから):', dropIndex);
            } else {
                // コンテナ内の他の場所にドロップされた場合、最も近い位置を計算
                const rect = container.getBoundingClientRect();
                const y = e.clientY - rect.top;
                const items = Array.from(container.querySelectorAll('.stock-item'));
                
                console.log('アイテム数:', items.length);
                console.log('ドロップY座標:', y);
                
                for (let i = 0; i < items.length; i++) {
                    const itemRect = items[i].getBoundingClientRect();
                    const itemY = itemRect.top - rect.top + itemRect.height / 2;
                    if (y < itemY) {
                        dropIndex = i;
                        break;
                    }
                }
                if (dropIndex === undefined) dropIndex = items.length - 1;
                console.log('dropIndex (計算から):', dropIndex);
            }
            
            // 同じ位置の場合は何もしない
            if (dropIndex === draggedIndex) {
                console.log('同じ位置のためスキップ');
                return;
            }
            
            console.log('配列移動開始: from', draggedIndex, 'to', dropIndex);
            console.log('移動前の配列:', this.tempTagStock);
            
            // 配列の要素を移動
            const item = this.tempTagStock.splice(draggedIndex, 1)[0];
            this.tempTagStock.splice(dropIndex, 0, item);
            
            console.log('移動後の配列:', this.tempTagStock);
            
            // 変更を反映するフラグを設定（再描画より前に設定）
            this.hasTagStockChanges = true;
            console.log('hasTagStockChanges:', this.hasTagStockChanges);
            
            // 再描画
            this.renderTagStock();
            
            // ドラッグ&ドロップを再初期化（要素が再作成されるため）
            setTimeout(() => this.initTagStockDragDrop(), 10);
        });
    }
    async init() {
        this.setupViewportHeightFix();
        this.setupEventListeners();

        // 初期表示を確実に「今すぐ」に同期（予約時刻入力は非表示）
        this.setTaskAddMode(this.taskAddMode);

        this.updateDateTime();
        this.updateTaskCounter();

        // 初期日付を記録
        const now = new Date();
        this.lastKnownDate = now.toDateString();
        console.log('アプリ初期化時の日付記録:', this.lastKnownDate);

        // Webアプリ前提: ローカルの /api を利用し、Supabaseログイン後にbootstrapする
        this.apiBaseUrl = window.location.origin;
        await this.initSupabaseAuth();

        // 時刻表示をリアルタイム寄りに更新（分境界に同期）
        this.startClock();

        // タブが非アクティブだとタイマーが抑制されるため、復帰時に予約到来を再チェック
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.maybeRefreshDueReservations();
            }
        });
        window.addEventListener('focus', () => this.maybeRefreshDueReservations());
        
        // デバッグ用のグローバル関数を設定
        window.app = this;
        window.forceRefreshToday = () => {
            console.log('手動でタスクデータを強制更新中...');
            this.handleDateChange();
        };
        window.validateDate = () => {
            console.log('日付整合性チェックを手動実行中...');
            this.validateTaskDateIntegrity();
        };
        window.checkServerData = async () => {
            console.log('サーバーのタスクデータをチェック中...');
            try {
                // 今日のデータ
                const todayResponse = await fetch(`${this.apiBaseUrl}/api/tasks`);
                const todayResult = await todayResponse.json();
                console.log('今日のデータ (api/tasks):', todayResult);
                
                // 履歴データ（今日の日付で）
                const now = new Date();
                // OSのローカル時間（日本時間）で今日の日付を取得
                const localDateParts = now.toLocaleDateString('ja-JP', { 
                    year: 'numeric', 
                    month: '2-digit', 
                    day: '2-digit',
                    timeZone: 'Asia/Tokyo'
                }).split('/');
                const today = `${localDateParts[0]}-${localDateParts[1]}-${localDateParts[2]}`;
                const historyResponse = await fetch(`${this.apiBaseUrl}/api/history/${today}`);
                const historyResult = await historyResponse.json();
                console.log(`履歴データ (api/history/${today}):`, historyResult);
            } catch (error) {
                console.error('サーバーデータチェックエラー:', error);
            }
        };
        window.checkYesterdayData = async () => {
            console.log('昨日の履歴データをチェック中...');
            try {
                const yesterday = '2025-07-22';
                const response = await fetch(`${this.apiBaseUrl}/api/history/${yesterday}`);
                const result = await response.json();
                console.log(`昨日のデータ (api/history/${yesterday}):`, result);
                
                if (result.success && result.data) {
                    console.log('昨日のタスク詳細:', result.data.tasks);
                } else {
                    console.log('昨日のデータが見つからないか、エラーです');
                }
            } catch (error) {
                console.error('昨日のデータチェックエラー:', error);
            }
        };
        window.testHistoryMode = () => {
            console.log('履歴モードをテスト中...');
            this.switchToHistoryMode();
            setTimeout(() => {
                this.onDateSelected('2025-07-22');
            }, 100);
        };
        window.filterTodayTasks = () => {
            console.log('手動で今日のタスクのみを表示...');
            const today = new Date();
            const todayString = today.toDateString();
            // OSのローカル時間（日本時間）で今日の日付を取得
            const localDateParts = today.toLocaleDateString('ja-JP', { 
                year: 'numeric', 
                month: '2-digit', 
                day: '2-digit',
                timeZone: 'Asia/Tokyo'
            }).split('/');
            const todayISOString = `${localDateParts[0]}-${localDateParts[1]}-${localDateParts[2]}`;
            
            const originalCount = this.tasks.length;
            this.tasks = this.tasks.filter(task => {
                if (task.createdAt) {
                    const taskDate = new Date(task.createdAt);
                    // OSのローカル時間（日本時間）で日付を取得してtoDateString形式で比較
                    const taskDateForComparison = new Date(taskDate.toLocaleDateString('en-US', { timeZone: 'Asia/Tokyo' })).toDateString();
                    return taskDateForComparison === todayString;
                }
                if (task.date) {
                    return task.date === todayISOString;
                }
                return true; // 日付情報がない場合は残す
            });
            
            console.log(`${originalCount}件から${this.tasks.length}件にフィルタリング`);
            this.updateTimeline();
            this.updateStats();
            this.updateTaskCounter();
            this.showToast(`今日のタスクのみ表示しました (${this.tasks.length}件)`);
        };
        window.cleanupTodayHistory = async () => {
            console.log('30日の履歴をクリーンアップ中...');
            try {
                const response = await fetch(`${this.apiBaseUrl}/api/history/cleanup`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetDate: '2025-07-30' })
                });
                const result = await response.json();
                console.log('クリーンアップ結果:', result);
                
                if (result.success) {
                    console.log(`✅ ${result.message}`);
                    // 履歴データリストを更新
                    await this.loadHistoryDates();
                } else {
                    console.error('❌ クリーンアップ失敗:', result.message);
                }
            } catch (error) {
                console.error('クリーンアップAPIエラー:', error);
            }
        };
    }

    startClock() {
        // 既存タイマーをクリア（再初期化時の多重起動防止）
        if (this._timeTickInterval) clearInterval(this._timeTickInterval);
        if (this._dateTimeInterval) clearInterval(this._dateTimeInterval);
        if (this._timeTickTimeout) clearTimeout(this._timeTickTimeout);
        if (this._dateTimeTimeout) clearTimeout(this._dateTimeTimeout);

        // 初回は即時反映
        this.updateDateTime();

        // 秒境界に合わせて「時刻だけ」を更新（分切り替わりも遅れない）
        const nowMs = Date.now();
        const msToNextSecond = 1000 - (nowMs % 1000);
        this._timeTickTimeout = setTimeout(() => {
            this.updateTimeOnly();
            this._timeTickInterval = setInterval(() => this.updateTimeOnly(), 1000);
        }, msToNextSecond);

        // 分境界に合わせて日付/日跨ぎ判定などを更新
        const msToNextMinute = 60000 - (nowMs % 60000);
        this._dateTimeTimeout = setTimeout(() => {
            this.updateDateTime();
            this._dateTimeInterval = setInterval(() => this.updateDateTime(), 60000);
        }, msToNextMinute);
    }

    updateTimeOnly() {
        const timeElement = document.getElementById('current-time');
        if (!timeElement) return;

        const now = new Date();
        const timeStr = now.toLocaleTimeString('ja-JP', {
            hour: '2-digit',
            minute: '2-digit'
        });
        if (timeElement.textContent !== timeStr) {
            timeElement.textContent = timeStr;
        }
    }

    async waitForAPI() {
        const maxRetries = 30; // 30秒まで待機
        for (let i = 0; i < maxRetries; i++) {
            try {
                console.log(`API接続確認 ${i + 1}/${maxRetries}...`);
                const response = await fetch(`${this.apiBaseUrl}/api/health`);
                if (response.ok) {
                    const result = await response.json();
                    if (result.status === 'healthy') {
                        console.log('API接続成功 - サーバー準備完了');
                        return true;
                    }
                }
            } catch (error) {
                console.log(`API接続待機中... (${error.message})`);
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.error('API接続がタイムアウトしました');
        return false;
    }

    setupEventListeners() {
        // モバイル: サイドバーをハンバーガーで開閉
        const menuBtn = document.getElementById('mobile-menu-btn');
        const overlay = document.getElementById('mobile-overlay');
        const sidebar = document.getElementById('mobile-sidebar') || document.querySelector('.sidebar');
        const mq = window.matchMedia ? window.matchMedia('(max-width: 768px)') : null;

        const closeSidebar = () => {
            document.body.classList.remove('sidebar-open');
            if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
        };

        const toggleSidebar = () => {
            const isOpen = document.body.classList.toggle('sidebar-open');
            if (menuBtn) menuBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        };

        if (menuBtn) {
            menuBtn.addEventListener('click', (e) => {
                e.preventDefault();
                toggleSidebar();
            });
        }
        if (overlay) {
            overlay.addEventListener('click', () => closeSidebar());
        }
        if (sidebar) {
            sidebar.addEventListener('click', (e) => {
                // モバイル時はサイドバー内の操作後に閉じる
                if (!mq || !mq.matches) return;
                // タスク追加モードの切替は閉じない
                if (e.target?.closest?.('.task-add-tabs')) return;
                if (e.target?.closest?.('button, a')) {
                    closeSidebar();
                }
            });
        }
        window.addEventListener('resize', () => {
            // デスクトップに戻ったら閉じる
            if (!mq || !mq.matches) closeSidebar();
        });

        // タスク追加モード切替
        const tabNow = document.getElementById('task-add-tab-now');
        const tabReserve = document.getElementById('task-add-tab-reserve');
        if (tabNow && tabReserve) {
            tabNow.addEventListener('click', () => this.setTaskAddMode('now'));
            tabReserve.addEventListener('click', () => this.setTaskAddMode('reserve'));
        }

        // タスク追加
        const addBtn = document.getElementById('add-task-btn');
        const taskInput = document.getElementById('task-input');
        
        addBtn.addEventListener('click', () => this.addTask());
        taskInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addTask();
        });

        // タスク終了
        document.getElementById('end-task-btn').addEventListener('click', () => this.endTask());

        // タイムラインコピー
        document.getElementById('copy-timeline-btn').addEventListener('click', () => this.copyTimeline());

        // すべてクリア（設定画面で初期化される）

        // 履歴機能
        document.getElementById('today-btn').addEventListener('click', () => {
            // iOS(PWA含む): dateピッカー開閉の副作用で「今日」クリックが入ることがあるため抑止
            if (this.currentMode === 'history' && Date.now() < (this._suppressTodayClickUntil || 0)) {
                console.log('日付ピッカー操作直後のため「今日」クリックを抑止しました');
                return;
            }
            this.switchToTodayMode();
        });
        document.getElementById('history-btn').addEventListener('click', () => this.switchToHistoryMode());
        
        // 日付入力イベントリスナーを遅延追加（DOM確実に存在する状態で）
        setTimeout(() => {
            const calendarInput = document.getElementById('calendar-date-input');
            if (calendarInput) {
                this._calendarInputWrap = document.getElementById('date-input-wrap');
                // 未来の日付を選択できないように最大値を設定（以後は自動更新）
                this.updateCalendarMaxDate();

                // 初期表示のガイド同期
                this.syncCalendarInputHint();

                // iOSで「開いた瞬間に今日が入ってchangeが走る」ことがあるため、開く直前の状態を記録
                const snapshotBeforeOpen = () => {
                    this._calendarLastInteractAt = Date.now();
                    this._calendarValueBeforeInteract = calendarInput.value || '';
                    // ピッカー開閉の前後は誤クリックが出やすいので、一定時間「今日」クリックを抑止
                    this._suppressTodayClickUntil = Date.now() + 2000;
                };
                calendarInput.addEventListener('pointerdown', snapshotBeforeOpen);
                calendarInput.addEventListener('touchstart', snapshotBeforeOpen, { passive: true });
                calendarInput.addEventListener('focus', snapshotBeforeOpen);

                // ピッカーが閉じた直後にも誤クリックが入ることがあるため、focusoutでも少し延長
                calendarInput.addEventListener('focusout', () => {
                    this._suppressTodayClickUntil = Math.max(this._suppressTodayClickUntil || 0, Date.now() + 600);
                });
                
                calendarInput.addEventListener('change', (e) => {
                    const nextValue = e.target.value;
                    console.log('日付変更イベントが発生しました:', nextValue);

                    // change後もしばらく誤クリック抑止
                    this._suppressTodayClickUntil = Math.max(this._suppressTodayClickUntil || 0, Date.now() + 600);

                    // iOS Safari/PWA: 未選択('')→今日 に自動補完されて即change、のようなケースは無視する
                    const todayStr = this.getTokyoTodayYmd();
                    const wasEmpty = !this._calendarValueBeforeInteract;
                    if (wasEmpty && nextValue === todayStr) {
                        console.log('日付ピッカーの自動補完(今日)とみなし、選択処理をスキップします');
                        e.target.value = this._calendarValueBeforeInteract || '';
                        this.syncCalendarInputHint();
                        return;
                    }

                    this.onDateSelected(nextValue);
                    this.syncCalendarInputHint();
                });

                // iOSで表示が空欄に見えることがあるので、入力/フォーカスでも同期
                calendarInput.addEventListener('input', () => this.syncCalendarInputHint());
                calendarInput.addEventListener('focus', () => this.syncCalendarInputHint());
                calendarInput.addEventListener('blur', () => this.syncCalendarInputHint());
                calendarInput.setAttribute('data-has-listener', 'true');
                console.log('日付入力イベントリスナーを追加しました');
                
                // テスト用のグローバル関数を追加
                window.testDateSelection = (dateString) => {
                    console.log('テスト用日付選択:', dateString);
                    this.onDateSelected(dateString);
                };
            } else {
                console.error('calendar-date-inputが見つかりません');
            }
            
        }, 100);

        // 報告書作成
        document.getElementById('create-report-btn').addEventListener('click', () => this.showReportDialog());

        // 設定
        document.getElementById('settings-btn').addEventListener('click', () => this.openSettingsDialog());

        // 目標ストック
        document.getElementById('goal-stock-btn').addEventListener('click', () => this.showGoalStockDialog());

        // タスクストック
        document.getElementById('task-stock-btn').addEventListener('click', async () => await this.showTaskStockDialog());
        
        // タグストック
        document.getElementById('tag-stock-btn').addEventListener('click', () => this.showTagStockDialog());

        // タイトルバーボタン（Web版ではタブが閉じるので無効化）
        const minimizeBtn = document.querySelector('.titlebar-button.minimize');
        const closeBtn = document.querySelector('.titlebar-button.close');

        if (this.isWebMode()) {
            const controls = document.querySelector('.titlebar-controls');
            if (controls) controls.style.display = 'none';
        } else {
            minimizeBtn?.addEventListener('click', () => {
                window.close(); // 最小化はcloseイベントで処理されタスクトレイに格納される
            });
            closeBtn?.addEventListener('click', () => {
                window.close();
            });
        }

        // 確認ダイアログのイベントリスナー
        document.getElementById('confirm-cancel').addEventListener('click', () => this.hideConfirmDialog());
        document.getElementById('confirm-ok').addEventListener('click', () => this.executeConfirmedAction());

        // 編集ダイアログのイベントリスナー
        document.getElementById('edit-close').addEventListener('click', () => this.hideEditDialog());
        document.getElementById('edit-cancel').addEventListener('click', () => this.hideEditDialog());
        document.getElementById('edit-save').addEventListener('click', () => this.saveTask());
        document.getElementById('edit-delete').addEventListener('click', () => this.deleteCurrentTask());
        document.getElementById('add-to-stock-btn').addEventListener('click', async () => await this.addTaskNameToStock());

        // 報告書ダイアログのイベントリスナー
        document.getElementById('report-close').addEventListener('click', () => this.handleReportClose());
        document.getElementById('report-cancel').addEventListener('click', () => this.handleReportClose());
        document.getElementById('copy-goals-btn').addEventListener('click', () => this.copyGoals());
        document.getElementById('report-copy').addEventListener('click', () => this.copyReport());
        document.getElementById('report-save').addEventListener('click', () => this.saveReport());

        // 設定ダイアログのイベントリスナー
        document.getElementById('settings-close').addEventListener('click', () => this.closeSettingsDialog());
        document.getElementById('settings-cancel').addEventListener('click', () => this.closeSettingsDialog());
        document.getElementById('settings-save').addEventListener('click', () => this.saveSettings());
        document.getElementById('add-url-btn').addEventListener('click', () => this.addReportUrl());
        document.getElementById('clear-all-btn').addEventListener('click', () => this.showClearConfirmation());

        // 目標ストックダイアログのイベントリスナー
        document.getElementById('goal-stock-close').addEventListener('click', () => this.hideGoalStockDialog());
        document.getElementById('goal-stock-cancel').addEventListener('click', () => this.hideGoalStockDialog());
        document.getElementById('add-goal-stock-btn').addEventListener('click', () => this.addGoalStock());
        document.getElementById('save-goal-stock-btn').addEventListener('click', () => this.saveGoalStockChanges());
        
        // 目標ストック入力のEnterキー対応
        document.getElementById('goal-stock-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addGoalStock();
        });

        // タスクストックダイアログのイベントリスナー
        document.getElementById('task-stock-close').addEventListener('click', () => this.hideTaskStockDialog());
        document.getElementById('task-stock-cancel').addEventListener('click', () => this.hideTaskStockDialog());
        document.getElementById('add-task-stock-btn').addEventListener('click', () => this.addTaskStock());
        document.getElementById('save-task-stock-btn').addEventListener('click', () => this.saveTaskStockChanges());
        
        // タスクストック入力のEnterキー対応
        document.getElementById('task-stock-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addTaskStock();
        });
        
        // タグストックダイアログのイベントリスナー
        document.getElementById('tag-stock-close').addEventListener('click', () => this.hideTagStockDialog());
        document.getElementById('tag-stock-cancel').addEventListener('click', () => this.hideTagStockDialog());
        document.getElementById('add-tag-stock-btn').addEventListener('click', () => this.addTagStock());
        document.getElementById('save-tag-stock-btn').addEventListener('click', () => this.saveTagStockChanges());
        
        // タグストック入力のEnterキー対応
        document.getElementById('tag-stock-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addTagStock();
        });
        
        // ウィンドウリサイズ時にタグスクロールボタンの状態を更新
        window.addEventListener('resize', () => {
            // 少し遅延してからボタン状態を更新（レイアウト調整後）
            setTimeout(() => this.updateTagScrollButtons(), 100);
        });
    }

    setTaskAddMode(mode) {
        this.taskAddMode = mode === 'reserve' ? 'reserve' : 'now';

        const tabNow = document.getElementById('task-add-tab-now');
        const tabReserve = document.getElementById('task-add-tab-reserve');
        const reserveTimeRow = document.getElementById('reserve-time-row');
        const reserveTimeInput = document.getElementById('reserve-time-input');
        const taskInput = document.getElementById('task-input');

        if (tabNow && tabReserve) {
            const isReserve = this.taskAddMode === 'reserve';
            tabNow.classList.toggle('active', !isReserve);
            tabReserve.classList.toggle('active', isReserve);
            tabNow.setAttribute('aria-selected', String(!isReserve));
            tabReserve.setAttribute('aria-selected', String(isReserve));
        }

        if (reserveTimeRow) {
            reserveTimeRow.hidden = this.taskAddMode !== 'reserve';
        }

        if (taskInput) {
            taskInput.placeholder = this.taskAddMode === 'reserve' ? '予約するタスク名を入力...' : '新しいタスクを入力...';
        }

        if (this.taskAddMode === 'reserve') {
            // まず時刻入力を促す
            reserveTimeInput?.focus?.();
        } else {
            taskInput?.focus?.();
        }
    }

    updateDateTime() {
        const now = new Date();
        const dateElement = document.getElementById('current-date');
        const timeElement = document.getElementById('current-time');

        // 時刻は常に更新（履歴モードでは非表示になるため問題なし）
        const timeStr = now.toLocaleTimeString('ja-JP', {
            hour: '2-digit',
            minute: '2-digit'
        });
        timeElement.textContent = timeStr;

        // 日付ピッカーの最大値（=今日）を最新化しておく（起動中の日跨ぎ対応）
        this.updateCalendarMaxDate();

        // 日付変更の検知（今日モードでのみ実行）
        if (this.currentMode !== 'history') {
            const currentDateString = now.toDateString(); // "Wed Jul 23 2025" 形式
            
            // 初回実行時は現在の日付を記録
            if (this.lastKnownDate === null) {
                this.lastKnownDate = currentDateString;
                console.log('初回日付記録:', this.lastKnownDate);
            }
            
            // 日付が変更された場合
            if (this.lastKnownDate !== currentDateString) {
                console.log('日付変更を検知:', this.lastKnownDate, '->', currentDateString);
                this.lastKnownDate = currentDateString;
                
                // 新しい日のタスクデータを読み込み
                this.handleDateChange();
            }
            
            // 日付表示を更新
            const dateStr = now.toLocaleDateString('ja-JP', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long'
            });
            dateElement.textContent = dateStr;

            // 予約開始時刻を過ぎたら表示を自動更新（サーバ側で予約→通常タスクへ切替される）
            this.maybeRefreshDueReservations();
        }
    }

    getTokyoNowMinutes() {
        const now = new Date();
        const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
        return jst.getHours() * 60 + jst.getMinutes();
    }

    parseTimeToMinutesFlexible(timeString) {
        if (!timeString) return null;
        const raw = String(timeString).trim();
        if (!raw.includes(':')) return null;

        const hhmmMatch = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
        if (hhmmMatch) {
            return parseInt(hhmmMatch[1], 10) * 60 + parseInt(hhmmMatch[2], 10);
        }

        const hasAm = raw.includes('午前');
        const hasPm = raw.includes('午後');
        if (!hasAm && !hasPm) return null;

        const timeOnly = raw.replace('午前', '').replace('午後', '').trim();
        const parts = timeOnly.split(':');
        if (parts.length !== 2) return null;

        let hour = parseInt(parts[0], 10);
        const minute = parseInt(parts[1], 10);
        if (Number.isNaN(hour) || Number.isNaN(minute)) return null;

        if (hasPm && hour !== 12) hour += 12;
        if (hasAm && hour === 12) hour = 0;
        return hour * 60 + minute;
    }

    maybeRefreshDueReservations() {
        if (this._dueReservationRefreshInFlight) return;
        if (this.currentMode === 'history') return;
        if (!Array.isArray(this.tasks) || this.tasks.length === 0) return;

        const nowMinutes = this.getTokyoNowMinutes();
        const hasDue = this.tasks.some((t) => {
            if (!this.isReservedTask(t)) return false;
            const minutes = this.parseTimeToMinutesFlexible(t.startTime);
            return minutes !== null && minutes <= nowMinutes;
        });

        if (!hasDue) return;

        this._dueReservationRefreshInFlight = true;
        Promise.resolve()
            .then(() => this.loadTasks())
            .catch((e) => console.warn('due reservation refresh failed:', e))
            .finally(() => {
                this._dueReservationRefreshInFlight = false;
            });
    }

    scheduleNextDueReservationRefresh() {
        if (this._dueReservationRefreshTimeout) {
            clearTimeout(this._dueReservationRefreshTimeout);
            this._dueReservationRefreshTimeout = null;
        }

        if (this.currentMode === 'history') return;
        if (!Array.isArray(this.tasks) || this.tasks.length === 0) return;

        const nowMinutes = this.getTokyoNowMinutes();
        const futureReservedMinutes = this.tasks
            .filter((t) => this.isReservedTask(t))
            .map((t) => this.parseTimeToMinutesFlexible(t.startTime))
            .filter((m) => m !== null && m > nowMinutes)
            .sort((a, b) => a - b);

        const nextMinutes = futureReservedMinutes[0];
        if (nextMinutes === undefined) return;

        const delayMs = Math.max(0, (nextMinutes - nowMinutes) * 60 * 1000 + 250);
        this._dueReservationRefreshTimeout = setTimeout(() => {
            this._dueReservationRefreshTimeout = null;
            this.maybeRefreshDueReservations();
        }, delayMs);
    }

    // 履歴モードの日付ピッカーに設定する「選択可能な最大日付（=今日）」を更新
    updateCalendarMaxDate() {
        const calendarInput = document.getElementById('calendar-date-input');
        if (!calendarInput) return;

        const todayStr = this.getTokyoTodayYmd();

        if (calendarInput.max !== todayStr) {
            calendarInput.max = todayStr;
            // もし現在値が未来日になっていたら補正（保険）
            if (calendarInput.value && calendarInput.value > todayStr) {
                calendarInput.value = todayStr;
            }
            console.log('calendar-date-input.max を更新:', todayStr);
        }
    }

    getTime() {
        let now = new Date();
        // 設定の丸めが有効なら、表示上も丸める（実際の保存はサーバ側でも丸め）
        const interval = this.settings?.timeRounding?.interval || 0;
        const mode = this.settings?.timeRounding?.mode || 'nearest';
        if (interval > 0) {
            const minutes = now.getMinutes();
            const remainder = minutes % interval;
            let adj = minutes;
            if (mode === 'floor') adj = minutes - remainder;
            else if (mode === 'ceil') adj = remainder === 0 ? minutes : minutes + (interval - remainder);
            else adj = remainder < interval/2 ? minutes - remainder : minutes + (interval - remainder);
            now.setSeconds(0,0);
            now.setMinutes(adj);
        }
        const hour = now.getHours();
        const minute = now.getMinutes();
        
        let period = '午前';
        let displayHour = hour;
        
        if (hour === 0) {
            displayHour = 12;
        } else if (hour === 12) {
            period = '午後';
        } else if (hour > 12) {
            displayHour = hour - 12;
            period = '午後';
        }
        
    return `${period} ${displayHour}:${minute.toString().padStart(2, '0')}`;
    }

    async handleDateChange() {
        console.log('日付変更処理を開始...');
        
        try {
            // 今日モードの場合のみ処理
            if (this.currentMode === 'today') {
                console.log('現在のタスクデータをクリア中...');
                
                // 現在のタスクをクリア
                this.tasks = [];
                this.currentTaskId = null;
                this.updateCurrentTask('タスクなし');
                
                // UIを即座に更新（空の状態で表示）
                this.updateTimeline();
                this.updateStats();
                this.updateTaskCounter();
                
                console.log('新しい日のタスクデータを読み込み中...');
                // 新しい日のタスクデータを読み込み
                await this.loadTasks();
                
                // 履歴日付リストを更新
                await this.loadHistoryDates();
                
                // カレンダーの最大日付（=今日）も更新
                this.updateCalendarMaxDate();
                
                this.showToast('新しい日になりました。タスクデータを更新しました。');
                console.log('日付変更処理完了');
            }
        } catch (error) {
            console.error('日付変更処理エラー:', error);
            this.showToast('日付変更時のデータ更新に失敗しました', 'error');
        }
    }

    // タスクデータの日付整合性をチェックして、古いデータを除去
    async validateTaskDateIntegrity() {
        console.log('タスクデータの日付整合性チェックを開始...');
        
        if (this.currentMode !== 'today') {
            console.log('今日モードでないためスキップ');
            return;
        }
        
        const today = new Date();
        const todayString = today.toDateString(); // "Wed Jul 23 2025" 形式
        // OSのローカル時間（日本時間）で今日の日付を取得
        const localDateParts = today.toLocaleDateString('ja-JP', { 
            year: 'numeric', 
            month: '2-digit', 
            day: '2-digit',
            timeZone: 'Asia/Tokyo'
        }).split('/');
        const todayISOString = `${localDateParts[0]}-${localDateParts[1]}-${localDateParts[2]}`;
        let hasOldTasks = false;
        
        console.log('今日の日付:', todayString, '(ISO:', todayISOString, ')');
        
        if (!this.tasks.length) {
            console.log('タスクが空のため、整合性チェック完了');
            return;
        }
        
        // タスクの日付をチェック（createdAt または日付情報があるかチェック）
        const oldTasks = [];
        this.tasks.forEach((task, index) => {
            console.log(`タスク ${index}: ${task.name}, startTime: ${task.startTime}`);
            
            let isOldTask = false;
            
            // タスクにcreatedAtがある場合はそれをチェック
            if (task.createdAt) {
                const taskDate = new Date(task.createdAt);
                // OSのローカル時間（日本時間）で日付を取得
                const taskDateString = taskDate.toLocaleDateString('ja-JP', {
                    year: 'numeric',
                    month: '2-digit', 
                    day: '2-digit',
                    weekday: 'long',
                    timeZone: 'Asia/Tokyo'
                });
                // DateStringと同じ形式で比較するため変換
                const taskDateForComparison = new Date(taskDate.toLocaleDateString('en-US', { timeZone: 'Asia/Tokyo' })).toDateString();
                console.log(`- createdAt: ${task.createdAt} (${taskDateForComparison})`);
                if (taskDateForComparison !== todayString) {
                    console.log(`- 古いタスクを検知: ${taskDateForComparison} != ${todayString}`);
                    isOldTask = true;
                }
            }
            
            // タスクにdateプロパティがある場合もチェック
            if (task.date) {
                console.log(`- task.date: ${task.date}`);
                if (task.date !== todayISOString) {
                    console.log(`- 古いタスクを検知 (date): ${task.date} != ${todayISOString}`);
                    isOldTask = true;
                }
            }
            
            if (isOldTask) {
                oldTasks.push(task);
                hasOldTasks = true;
            }
        });
        
        // lastKnownDateとの比較もチェック
        if (this.lastKnownDate && this.lastKnownDate !== todayString) {
            console.log('日付不整合を検知 (lastKnownDate):', this.lastKnownDate, '!=', todayString);
            hasOldTasks = true;
        }
        
        if (hasOldTasks) {
            console.log('古いタスクデータを検知:', oldTasks.length, '件');
            console.log('古いタスク:', oldTasks);
            
            // 古いタスクを配列から除外
            this.tasks = this.tasks.filter(task => {
                if (task.createdAt) {
                    const taskDate = new Date(task.createdAt);
                    // OSのローカル時間（日本時間）で日付を取得してtoDateString形式で比較
                    const taskDateForComparison = new Date(taskDate.toLocaleDateString('en-US', { timeZone: 'Asia/Tokyo' })).toDateString();
                    return taskDateForComparison === todayString;
                }
                if (task.date) {
                    return task.date === todayISOString;
                }
                // 日付情報がない場合は残す
                return true;
            });
            
            console.log('フィルタリング後のタスク数:', this.tasks.length);
            
            // UIを更新
            this.updateTimeline();
            this.updateStats();
            this.updateTaskCounter();
            
            if (oldTasks.length > 0) {
                this.showToast(`${oldTasks.length}件の過去のタスクを非表示にしました`, 'warning');
            }
        } else {
            console.log('タスクデータの日付整合性OK');
        }
    }

    async addTask() {
        if (this.taskAddMode === 'reserve') {
            await this.addReservation();
            return;
        }
        const taskInput = document.getElementById('task-input');
        const taskTagSelect = document.getElementById('task-tag-select');
        const taskName = taskInput.value.trim();
        const selectedTag = taskTagSelect ? taskTagSelect.value : '';

        if (!taskName) {
            this.showToast('タスク名を入力してください', 'warning');
            return;
        }

        console.log('=== addTask 開始 ===');
        console.log('currentMode:', this.currentMode);
        console.log('currentDate:', this.currentDate);
        console.log('selectedDate:', this.selectedDate);
        console.log('selectedTag:', selectedTag);

        // 履歴モードで日付が未選択の場合は追加を阻止
        if (this.currentMode === 'history' && !this.currentDate) {
            console.log('履歴モードで日付未選択のため、タスク追加を阻止');
            this.showToast('履歴モードでは先に日付を選択してください', 'warning');
            return;
        }

        // 現在実行中のタスクがあるかチェック
        const currentRunningTask = this.tasks.find(task => this.isRunningTask(task));
        
        // 直前のタスクの終了時刻を取得（新しいタスクの開始時刻として使用）
        let startTime = null;
        
        if (currentRunningTask) {
            // 実行中のタスクがある場合は、現在時刻でそのタスクを終了させ、その時刻を新しいタスクの開始時刻として使用
            startTime = this.getTime(); // 現在時刻を取得
            console.log(`実行中のタスクがあるため、現在時刻で直前のタスクを終了し、新しいタスクの開始時刻に設定: ${startTime}`);
        } else {
            // 実行中のタスクがない場合は、最後に終了したタスクの終了時刻を使用
            const lastCompletedTask = this.tasks
                .filter(task => task.endTime) // 終了済みのタスクのみ
                .sort((a, b) => new Date(a.updatedAt || a.createdAt) - new Date(b.updatedAt || b.createdAt)) // 更新日時でソート
                .pop(); // 最後のタスクを取得
            
            if (lastCompletedTask && lastCompletedTask.endTime) {
                startTime = lastCompletedTask.endTime;
                console.log(`直前の終了済みタスクの終了時刻を新しいタスクの開始時刻に設定: ${startTime}`);
            }
        }
        
        try {
            // 統一されたAPI呼び出し（日付パラメータ付き）
            const requestData = { 
                name: taskName, 
                tag: selectedTag || null,
                dateString: this.currentDate, // null = 今日、文字列 = 指定日
                startTime: startTime // 直前のタスクの終了時刻を開始時刻として設定
            };
            
            console.log('API リクエストデータ:', requestData);
            
            const response = await fetch(`${this.apiBaseUrl}/api/tasks`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify(requestData) 
            });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    taskInput.value = '';
                    // タグ選択もリセット
                    if (taskTagSelect) {
                        taskTagSelect.selectedIndex = 0;
                    }
                    
                    // 統一されたタスク読み込み
                    if (this.currentDate) {
                        // 履歴データの場合 - 自動でデータを読み込み、作成されている
                        await this.loadHistoryData(this.currentDate);
                    } else {
                        // 今日のデータの場合
                        await this.loadTasks();
                    }
                    
                    // 前のタスクが自動終了された場合の通知
                    if (currentRunningTask) {
                        this.showToast(`「${currentRunningTask.name}」を終了し、「${taskName}」を開始しました`);
                    } else {
                        this.showToast(`タスク「${taskName}」を開始しました`);
                    }
                    
                    // 今日のタスクの場合のみ現在タスクを更新
                    if (!this.currentDate) {
                        this.currentTaskId = result.taskId;
                        this.updateCurrentTask(taskName);
                    }
                    
                    // 報告書ダイアログが開いている場合はタグサマリーも更新
                    const reportDialog = document.getElementById('report-dialog');
                    if (reportDialog && reportDialog.classList.contains('show')) {
                        await this.generateTagSummary();
                    }
                }
            }
        } catch (error) {
            console.error('タスク追加エラー:', error);
            this.showToast('タスクの追加に失敗しました', 'error');
        }
    }


    async endTask() {
        // 過去日付では今日のタスク操作を無効化
        if (this.currentDate) {
            this.showToast('過去日付ではタスクを終了できません', 'warning');
            return;
        }
        
        // 実行中のタスクがあるかチェック
        const runningTask = this.tasks.find(task => this.isRunningTask(task));
        
        if (!runningTask) {
            this.showToast('終了するタスクがありません', 'warning');
            return;
        }

        try {
            const response = await fetch(`${this.apiBaseUrl}/api/tasks/end`, { method: 'POST' });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    await this.loadTasks();
                    this.showToast(`タスク「${runningTask.name}」を終了しました`);
                    this.currentTaskId = null;
                    this.updateCurrentTask('タスクなし');
                }
            }
        } catch (error) {
            console.error('タスク終了エラー:', error);
            this.showToast('タスクの終了に失敗しました', 'error');
        }
    }

    async copyTimeline() {
        try {
            // タイムラインテキストを生成
            let timelineText = '';
            
            if (this.tasks.length === 0) {
                timelineText = '今日はまだタスクがありません';
            } else {
                // タスクを時系列順で整理
                const sortedTasks = [...this.tasks].sort((a, b) => {
                    const timeA = this.convertTo24Hour(a.startTime);
                    const timeB = this.convertTo24Hour(b.startTime);
                    return timeA.localeCompare(timeB);
                });

                timelineText = sortedTasks.map(task => {
                    const startTime = task.startTime; // 午前/午後形式をそのまま使用
                    const endTime = this.isReservedTask(task) ? '予約' : (task.endTime ? task.endTime : '実行中');

                    const displayName = task.name;
                    
                    let line;
                    if (task.endTime) {
                        // 完了タスクは「午前 08:59 ~ 午前 12:00」形式
                        line = `${startTime} ~ ${endTime}\n${displayName}`;
                    } else {
                        // 実行中タスクは「午前 08:59 ~ 実行中」形式
                        line = `${startTime} ~ ${endTime}\n${displayName}`;
                    }
                    
                    return line;
                }).join('\n');
            }
            
            // クリップボードにコピー
            await navigator.clipboard.writeText(timelineText);
            this.showToast('タイムラインをクリップボードにコピーしました');
            
        } catch (error) {
            console.error('タイムラインコピーエラー:', error);
            this.showToast('コピーに失敗しました', 'error');
        }
    }

    async loadTasks() {
        try {
            console.log('今日のタスクデータの読み込みを開始...');
            // 今日のタスクを読み込む際は currentDate を null に設定
            this.currentDate = null;
            console.log('currentDate を null に設定しました (今日モード)');
            
            // 元の仕様通り、日付パラメータなしでAPIを呼び出し（サーバー側で今日のデータを返す）
            const response = await fetch(`${this.apiBaseUrl}/api/tasks`);
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    const allTasks = result.tasks;
                    console.log('サーバーから取得したタスク数:', allTasks.length);
                    console.log('全タスクデータ:', allTasks);

                    // 今日の日付でタスクをフィルタリング
                    const today = new Date();
                    const todayString = today.toDateString(); // "Wed Jul 23 2025" 形式
                    // UTC時差問題を避けるためにローカル時間を使用
                    // OSのローカル時間（日本時間）で今日の日付を取得
                    const localDateParts = today.toLocaleDateString('ja-JP', { 
                        year: 'numeric', 
                        month: '2-digit', 
                        day: '2-digit',
                        timeZone: 'Asia/Tokyo'
                    }).split('/');
                    const todayISOString = `${localDateParts[0]}-${localDateParts[1]}-${localDateParts[2]}`;
                    
                    console.log('今日の日付フィルタ:', todayString, '(ISO:', todayISOString, ')');
                    
                    // タスクを今日のもののみにフィルタリング
                    const todayTasks = allTasks.filter(task => {
                        // createdAtによる判定
                        if (task.createdAt) {
                            const taskDate = new Date(task.createdAt);
                            // OSのローカル時間（日本時間）で日付を取得してtoDateString形式で比較
                            const taskDateForComparison = new Date(taskDate.toLocaleDateString('en-US', { timeZone: 'Asia/Tokyo' })).toDateString();
                            const isToday = taskDateForComparison === todayString;
                            console.log(`タスク "${task.name}": createdAt=${task.createdAt}, taskDate=${taskDateForComparison}, isToday=${isToday}`);
                            return isToday;
                        }
                        
                        // dateプロパティによる判定
                        if (task.date) {
                            const isToday = task.date === todayISOString;
                            console.log(`タスク "${task.name}": date=${task.date}, isToday=${isToday}`);
                            return isToday;
                        }
                        
                        // 日付情報がない場合は、今日のタスクとして扱う（後方互換性）
                        console.log(`タスク "${task.name}": 日付情報なし、今日のタスクとして扱う`);
                        return true;
                    });
                    
                    console.log('フィルタリング後の今日のタスク数:', todayTasks.length);
                    console.log('今日のタスクデータ:', todayTasks);

                    this.tasks = todayTasks;
                    this.updateTimeline();
                    this.updateStats();
                    this.updateTaskCounter();

                    // 次の予約開始時刻に合わせて自動更新（表示の取りこぼし防止）
                    this.scheduleNextDueReservationRefresh();

                    // 現在実行中のタスクを更新
                    const runningTask = this.tasks.find(task => this.isRunningTask(task));
                    if (runningTask) {
                        console.log('実行中のタスク:', runningTask);
                        this.currentTaskId = runningTask.id;
                        this.updateCurrentTask(runningTask.name);
                    } else {
                        console.log('実行中のタスクはありません');
                        this.currentTaskId = null;
                        this.updateCurrentTask('タスクなし');
                    }

                    console.log('タスクデータの読み込み完了');
                    
                    // 日付整合性チェックを即座に実行（古いデータが混入していないかチェック）
                    await this.validateTaskDateIntegrity();
                }
            }
        } catch (error) {
            console.error('タスク読み込みエラー:', error);
        }
    }

    updateTimeline() {
        const container = document.getElementById('timeline-container');
        
        console.log('タイムライン更新中...', this.tasks);
        
        if (this.tasks.length === 0) {
            console.log('タスクが0件のため空表示');
            container.innerHTML = `
                <div class="timeline-empty">
                    <span class="material-icons">schedule</span>
                    <p>まだタスクがありません</p>
                    <p class="sub-text">新しいタスクを追加してください</p>
                </div>
            `;
            return;
        }

        const sortedTasks = [...this.tasks].sort((a, b) => {
            const timeA = this.convertTo24Hour(a.startTime);
            const timeB = this.convertTo24Hour(b.startTime);
            return timeA.localeCompare(timeB);
        });

        const timelineHTML = sortedTasks.map(task => {
            const startTime = this.formatTime(task.startTime);
            const isReserved = this.isReservedTask(task);
            const endTime = isReserved ? '予約' : (task.endTime ? this.formatTime(task.endTime) : '実行中');
            const duration = (!isReserved && task.endTime) ? this.calculateDuration(task.startTime, task.endTime) : '';
            const isRunning = this.isRunningTask(task);

            const timeColumnHTML = (!isReserved && task.endTime)
                ? `<div class="timeline-time range"><span class="time-start">${startTime}</span><span class="time-line" aria-hidden="true"></span><span class="time-end">${this.formatTime(task.endTime)}</span></div>`
                : `<div class="timeline-time">${startTime}</div>`;
            
            // デバッグ情報
            if (task.endTime) {
                console.log('タスク詳細:', {
                    name: task.name,
                    startTime: task.startTime,
                    endTime: task.endTime,
                    duration: duration
                });
            }
            
            // クラスを動的に設定
            let itemClass = 'timeline-item';
            if (isRunning) {
                // 実行中の通常タスク
                itemClass += ' running';
            } else if (isReserved) {
                itemClass += ' reserved';
            }
            
            // タスク名を表示用に整形
            let displayName = task.name;
            
            // タグの表示
            const tagDisplay = task.tag ? `<span class="task-tag">${task.tag}</span>` : '';
            const statusChip = isReserved
                ? `<span class="timeline-duration" style="background: var(--purple); color: var(--bg-primary);">予約</span>`
                : (isRunning ? `<span class="timeline-duration" style="background: var(--accent); color: white;">実行中</span>` : '');
            
            return `
                <div class="${itemClass}">
                    ${timeColumnHTML}
                    <div class="timeline-content">
                        <div class="timeline-task" onclick="app.copyTaskToInput('${displayName.replace(/'/g, "\'")}', event)" oncontextmenu="app.copyTaskToInput('${displayName.replace(/'/g, "\'")}', event)" title="クリックでタスク名をコピー">
                            ${displayName}
                        </div>
                        <div class="timeline-meta">
                            ${duration ? `<span class="timeline-duration">${duration}</span>` : ''}
                            ${tagDisplay}
                            ${statusChip}
                        </div>
                    </div>
                    <button class="timeline-edit" onclick="app.editTask('${task.id}')" title="編集">
                        <span class="material-icons">edit</span>
                    </button>
                </div>
            `;
        }).join('');

        container.innerHTML = timelineHTML;
    }

    updateStats() {
        const completedWorkTasks = this.tasks.filter(task => task.endTime && !this.isReservedTask(task)).length;
        const totalWorkTime = this.calculateTotalWorkTime();
        const productivity = this.calculateProductivity();

        document.getElementById('completed-tasks').textContent = completedWorkTasks;
        document.getElementById('work-time').textContent = totalWorkTime;
        document.getElementById('productivity').textContent = productivity;
    }

    updateTaskCounter() {
        const activeTasks = this.tasks.filter(task => this.isRunningTask(task)).length;
        document.getElementById('task-count').textContent = activeTasks;
        
        // 実行中のタスクがない場合はタスク終了ボタンを非表示
        this.updateEndTaskButtonVisibility();
    }

    updateEndTaskButtonVisibility() {
        const endTaskBtn = document.getElementById('end-task-btn');
        const runningTasks = this.tasks.filter(task => this.isRunningTask(task));

        // 実行中のタスクがない場合は非表示
        if (runningTasks.length === 0) {
            endTaskBtn.style.display = 'none';
        } else {
            endTaskBtn.style.display = 'flex';
        }
    }

    updateCurrentTask(taskName) {
        document.getElementById('current-task').textContent = taskName;
    }

    formatTime(timeString) {
        // "午前 10:30" -> "10:30"
        if (!timeString) return '';

        const normalized = timeString.replace('午前 ', '').replace('午後 ', '').trim();
        if (!normalized.includes(':')) return normalized;

        const [rawHours, rawMinutes] = normalized.split(':');
        const hours = String(parseInt(rawHours, 10)).padStart(2, '0');
        const minutes = String(parseInt(rawMinutes, 10)).padStart(2, '0');
        if (hours === 'NaN' || minutes === 'NaN') return normalized;
        return `${hours}:${minutes}`;
    }

    // 12時間形式（午前/午後）を24時間形式（HH:mm）に変換
    convertTo24Hour(timeString) {
        if (!timeString) return '';
        
        const isAM = timeString.includes('午前');
        const timeOnly = timeString.replace('午前 ', '').replace('午後 ', '').trim();
        
        if (!timeOnly.includes(':')) return '';
        
        const [hours, minutes] = timeOnly.split(':');
        let hour = parseInt(hours);
        
        if (!isAM && hour !== 12) {
            hour += 12;
        } else if (isAM && hour === 12) {
            hour = 0;
        }
        
        return `${hour.toString().padStart(2, '0')}:${minutes.padStart(2, '0')}`;
    }

    // 24時間形式（HH:mm）を12時間形式（午前/午後）に変換
    convertTo12Hour(timeString) {
        if (!timeString) return '';
        
        const [hours, minutes] = timeString.split(':');
        let hour = parseInt(hours);
        const minute = minutes;
        
        let period = '午前';
        if (hour === 0) {
            hour = 12;
        } else if (hour === 12) {
            period = '午後';
        } else if (hour > 12) {
            hour -= 12;
            period = '午後';
        }
        
        return `${period} ${hour}:${minute}`;
    }

    calculateDuration(startTime, endTime) {
        if (!startTime || !endTime) return '';
        
        try {
            // "午前 10:30" -> Date オブジェクトに変換
            const parseTime = (timeStr) => {
                console.log('パース対象:', timeStr); // デバッグ用
                
                const isAM = timeStr.includes('午前');
                const timeOnly = timeStr.replace('午前 ', '').replace('午後 ', '').trim();
                
                // 時間フォーマットの検証
                if (!timeOnly.includes(':')) {
                    console.error('無効な時間フォーマット:', timeOnly);
                    return null;
                }
                
                const timeParts = timeOnly.split(':');
                if (timeParts.length !== 2) {
                    console.error('時間の分割に失敗:', timeParts);
                    return null;
                }
                
                const hours = parseInt(timeParts[0], 10);
                const minutes = parseInt(timeParts[1], 10);
                
                if (isNaN(hours) || isNaN(minutes)) {
                    console.error('時間の変換に失敗:', { hours, minutes });
                    return null;
                }
                
                let hour24 = hours;
                if (!isAM && hours !== 12) hour24 += 12;
                if (isAM && hours === 12) hour24 = 0;
                
                const date = new Date();
                date.setHours(hour24, minutes, 0, 0);
                return date;
            };
            
            const start = parseTime(startTime);
            const end = parseTime(endTime);
            
            if (!start || !end) {
                console.error('時間のパースに失敗:', { startTime, endTime });
                return '';
            }
            
            const diffMs = end - start;
            
            if (diffMs < 0) {
                console.log('負の時間差（日をまたぐ可能性）:', diffMs);
                return ''; // 不正な時間
            }
            
            const diffMinutes = Math.floor(diffMs / (1000 * 60));
            const hours = Math.floor(diffMinutes / 60);
            const minutes = diffMinutes % 60;
            
            if (hours > 0) {
                return `${hours}時間${minutes > 0 ? minutes + '分' : ''}`;
            } else {
                return `${minutes}分`;
            }
        } catch (error) {
            console.error('時間計算エラー:', error, { startTime, endTime });
            return '';
        }
    }

    calculateDurationInMinutes(startTime, endTime) {
        if (!startTime || !endTime) return 0;
        
        try {
            // "午前 10:30" -> Date オブジェクトに変換
            const parseTime = (timeStr) => {
                const isAM = timeStr.includes('午前');
                const timeOnly = timeStr.replace('午前 ', '').replace('午後 ', '').trim();
                
                if (!timeOnly.includes(':')) {
                    return null;
                }
                
                const timeParts = timeOnly.split(':');
                if (timeParts.length !== 2) {
                    return null;
                }
                
                const hours = parseInt(timeParts[0], 10);
                const minutes = parseInt(timeParts[1], 10);
                
                if (isNaN(hours) || isNaN(minutes)) {
                    return null;
                }
                
                let hour24 = hours;
                if (!isAM && hours !== 12) hour24 += 12;
                if (isAM && hours === 12) hour24 = 0;
                
                const date = new Date();
                date.setHours(hour24, minutes, 0, 0);
                return date;
            };
            
            const start = parseTime(startTime);
            const end = parseTime(endTime);
            
            if (!start || !end) {
                return 0;
            }
            
            const diffMs = end - start;
            
            if (diffMs < 0) {
                return 0; // 不正な時間
            }
            
            return Math.floor(diffMs / (1000 * 60)); // 分単位で返す
        } catch (error) {
            console.error('時間計算エラー:', error, { startTime, endTime });
            return 0;
        }
    }

    calculateTotalWorkTime() {
        // 完了したタスクの合計時間を計算
        const totalMinutes = this.tasks.reduce((total, task) => {
            if (task.endTime && task.startTime && !this.isReservedTask(task)) {
                const duration = this.calculateDuration(task.startTime, task.endTime);
                if (!duration) return total;
                
                // "1時間30分" -> 90分に変換
                const hours = duration.match(/(\d+)時間/);
                const minutes = duration.match(/(\d+)分/);
                
                let taskMinutes = 0;
                if (hours) {
                    const hourValue = parseInt(hours[1], 10);
                    if (!isNaN(hourValue)) taskMinutes += hourValue * 60;
                }
                if (minutes) {
                    const minuteValue = parseInt(minutes[1], 10);
                    if (!isNaN(minuteValue)) taskMinutes += minuteValue;
                }
                
                return total + taskMinutes;
            }
            return total;
        }, 0);

        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return `${hours}:${minutes.toString().padStart(2, '0')}`;
    }

    calculateProductivity() {
        const workTasks = this.tasks.filter(task => !this.isReservedTask(task));
        if (workTasks.length === 0) return '-';
        const completedRatio = workTasks.filter(task => task.endTime).length / workTasks.length;
        return `${Math.round(completedRatio * 100)}%`;
    }

    copyTaskToInput(taskName, event) {
        // 右クリックの場合のみコンテキストメニューを無効化
        if (event.type === 'contextmenu') {
            event.preventDefault();
        }
        
        const taskInput = document.getElementById('task-input');
        // 既存の入力内容をクリアしてから新しいタスク名をセット
        taskInput.value = '';
        taskInput.value = taskName;
        taskInput.focus();
        // カーソルを最後に移動
        taskInput.setSelectionRange(taskInput.value.length, taskInput.value.length);
        
        this.showToast(`「${taskName}」をタスク入力にコピーしました`);
    }

    showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        const messageElement = document.getElementById('toast-message');
        
        // 既存のタイマーをクリア
        if (this.toastTimer) {
            clearTimeout(this.toastTimer);
            this.toastTimer = null;
        }
        
        // 既に表示されている場合は一度非表示にしてから再表示
        if (toast.classList.contains('show')) {
            toast.classList.remove('show');
            
            // 少し待ってから新しいメッセージを表示
            setTimeout(() => {
                this.displayToast(toast, messageElement, message, type);
            }, 100);
        } else {
            this.displayToast(toast, messageElement, message, type);
        }
    }
    
    displayToast(toast, messageElement, message, type) {
        messageElement.textContent = message;
        
        // タイプに応じて色を変更
        const colors = {
            success: 'var(--success)',
            warning: 'var(--warning)',
            error: 'var(--error)'
        };
        
        toast.style.background = colors[type] || colors.success;
        toast.classList.add('show');
        
        // 新しいタイマーを設定
        this.toastTimer = setTimeout(() => {
            toast.classList.remove('show');
            this.toastTimer = null;
        }, 3000);
    }

    showClearConfirmation() {
        const dialog = document.getElementById('confirm-dialog');
        const title = document.getElementById('confirm-title');
        const message = document.getElementById('confirm-message');
        
        title.textContent = 'すべてのタイムラインデータを削除';
        message.textContent = 'すべてのタイムラインデータ（今日・履歴を含む）が完全に削除されます。この操作は元に戻せません。本当に実行しますか？';
        
        this.pendingAction = 'clearAll';
        dialog.classList.add('show');
    }

    hideConfirmDialog() {
        const dialog = document.getElementById('confirm-dialog');
        dialog.classList.remove('show');
        this.pendingAction = null;
        this.pendingTaskId = null; // クリーンアップ
        this.pendingDate = null; // クリーンアップ
    }


    async clearAllTasks() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/timeline/clear-all`, { method: 'POST' });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.tasks = [];
                    this.currentTaskId = null;
                    this.updateTimeline();
                    this.updateStats();
                    this.updateTaskCounter();
                    this.updateCurrentTask('タスクなし');
                    this.showToast('すべてのタイムラインデータを削除しました');
                    
                    // 履歴データを再読み込み
                    await this.loadHistoryDates();
                } else {
                    this.showToast('タイムラインデータの削除に失敗しました', 'error');
                }
            }
        } catch (error) {
            console.error('タイムラインデータ削除エラー:', error);
            this.showToast('タイムラインデータの削除に失敗しました', 'error');
        }
    }

    editTask(taskId) {
        // タスクIDの比較を柔軟に行う
        const task = this.tasks.find(t => {
            // まず完全一致を試行
            if (t.id === taskId) {
                return true;
            }
            
            // 文字列と数値の混在パターンを処理
            if (typeof t.id === 'string' && typeof taskId === 'number') {
                const match = t.id.match(/\d+/);
                const tIdNum = match ? parseInt(match[0]) : null;
                return tIdNum === taskId;
            }
            
            if (typeof t.id === 'number' && typeof taskId === 'string') {
                const match = taskId.match(/\d+/);
                const taskIdNum = match ? parseInt(match[0]) : null;
                return t.id === taskIdNum;
            }
            
            return false;
        });
        
        if (!task) {
            console.error('今日のタスクが見つかりません:', {
                searchingTaskId: taskId,
                searchingTaskIdType: typeof taskId,
                availableTasks: this.tasks.map(t => ({ id: t.id, type: typeof t.id, name: t.name }))
            });
            this.showToast('タスクが見つかりません', 'error');
            return;
        }

        // 編集ダイアログに値を設定（time inputは24時間形式で設定）
        document.getElementById('edit-task-name').value = task.name;
        document.getElementById('edit-start-time').value = this.convertTo24Hour(task.startTime);
        document.getElementById('edit-end-time').value = task.endTime ? this.convertTo24Hour(task.endTime) : '';

        this.editingTaskId = taskId;
        this.editingDate = null; // 今日のタスクを編集中
        
        // 編集ダイアログにタグドロップダウンを更新してからタグ値を設定
        this.updateEditTagDropdown();
        document.getElementById('edit-task-tag').value = task.tag || '';
        this.showEditDialog();
    }

    async editHistoryTask(dateString, taskId) {
        try {
            // 履歴データを取得
            const response = await fetch(`${this.apiBaseUrl}/api/history/${dateString}`);
            if (!response.ok) {
                this.showToast('履歴データの取得に失敗しました', 'error');
                return;
            }
            
            const result = await response.json();
            if (!result.success || !result.data || !result.data.tasks) {
                this.showToast('履歴データが見つかりません', 'error');
                return;
            }
            
            console.log('履歴データのタスク一覧:', result.data.tasks);
            console.log('探しているタスクID:', taskId, typeof taskId);
            
            // タスクIDの比較を柔軟に行う
            const task = result.data.tasks.find(t => {
                console.log(`比較中: t.id="${t.id}" (${typeof t.id}) vs taskId="${taskId}" (${typeof taskId})`);
                
                // まず完全一致を試行
                if (t.id === taskId) {
                    return true;
                }
                
                // 文字列と数値の混在パターンを処理
                if (typeof t.id === 'string' && typeof taskId === 'number') {
                    const match = t.id.match(/\d+/);
                    const tIdNum = match ? parseInt(match[0]) : null;
                    console.log(`文字列→数値比較: tIdNum=${tIdNum} vs taskId=${taskId}`);
                    return tIdNum === taskId;
                }
                
                if (typeof t.id === 'number' && typeof taskId === 'string') {
                    const match = taskId.match(/\d+/);
                    const taskIdNum = match ? parseInt(match[0]) : null;
                    console.log(`数値→文字列比較: t.id=${t.id} vs taskIdNum=${taskIdNum}`);
                    return t.id === taskIdNum;
                }
                
                return false;
            });
            
            console.log('見つかったタスク:', task);
            
            if (!task) {
                this.showToast('指定されたタスクが見つかりません', 'error');
                return;
            }

            console.log('編集ダイアログに設定する値:');
            console.log('- task.name:', task.name);
            console.log('- task.title:', task.title);
            console.log('- task.startTime:', task.startTime);
            console.log('- task.endTime:', task.endTime);

            // 編集ダイアログに値を設定
            const taskName = task.name || task.title || '';
            const taskTag = task.tag || '';
            const startTime24 = this.convertTo24Hour(task.startTime);
            const endTime24 = task.endTime ? this.convertTo24Hour(task.endTime) : '';
            
            console.log('変換後の値:');
            console.log('- taskName:', taskName);
            console.log('- taskTag:', taskTag);
            console.log('- startTime24:', startTime24);
            console.log('- endTime24:', endTime24);
            
            document.getElementById('edit-task-name').value = taskName;
            document.getElementById('edit-start-time').value = startTime24;
            document.getElementById('edit-end-time').value = endTime24;

            this.editingTaskId = taskId;
            this.editingDate = dateString; // 履歴のタスクを編集中
            
            console.log('編集状態を設定:');
            console.log('- this.editingTaskId:', this.editingTaskId);
            console.log('- this.editingDate:', this.editingDate);
            
            // 編集ダイアログにタグドロップダウンを更新してからタグ値を設定
            this.updateEditTagDropdown();
            document.getElementById('edit-task-tag').value = taskTag;
            this.showEditDialog();
            console.log('編集ダイアログを表示しました');
        } catch (error) {
            console.error('履歴タスク編集エラー:', error);
            this.showToast('履歴タスクの編集に失敗しました', 'error');
        }
    }

    showEditDialog() {
        const dialog = document.getElementById('edit-dialog');
        dialog.classList.add('show');
    }

    hideEditDialog() {
        const dialog = document.getElementById('edit-dialog');
        dialog.classList.remove('show');
        this.editingTaskId = null;
        this.editingDate = null; // 履歴タスクの編集状態もクリア
    }

    async saveTask() {
        const taskName = document.getElementById('edit-task-name').value.trim();
        const taskTag = document.getElementById('edit-task-tag').value.trim();
        const startTime24 = document.getElementById('edit-start-time').value.trim();
        const endTime24 = document.getElementById('edit-end-time').value.trim();

        if (!taskName || !startTime24) {
            this.showToast('タスク名と開始時刻は必須です', 'warning');
            return;
        }

        // 24時間形式を12時間形式（午前/午後）に変換
        const startTime = this.convertTo12Hour(startTime24);
        const endTime = endTime24 ? this.convertTo12Hour(endTime24) : '';

        try {
            const taskData = {
                name: taskName,
                tag: taskTag || null,
                startTime: startTime,
                endTime: endTime
            };

            let apiUrl, reloadFunction;
            
            console.log('saveTask - 編集状態確認:');
            console.log('- this.editingDate:', this.editingDate);
            console.log('- this.editingTaskId:', this.editingTaskId);
            
            if (this.editingDate) {
                // 履歴タスクの編集
                apiUrl = `${this.apiBaseUrl}/api/history/${this.editingDate}/tasks/${this.editingTaskId}`;
                reloadFunction = () => this.loadHistoryData(this.editingDate);
                console.log('履歴タスクの編集モード - API URL:', apiUrl);
            } else {
                // 今日のタスクの編集
                apiUrl = `${this.apiBaseUrl}/api/tasks/${this.editingTaskId}`;
                reloadFunction = () => this.loadTasks();
                console.log('今日のタスクの編集モード - API URL:', apiUrl);
            }

            console.log('API request - URL:', apiUrl);
            console.log('API request - データ:', taskData);
            
            const response = await fetch(apiUrl, { 
                method: 'PUT', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify(taskData) 
            });
            
            console.log('API response status:', response.status);
            console.log('API response ok:', response.ok);
            
            if (response.ok) {
                const result = await response.json();
                console.log('API response data:', result);
                
                if (result.success) {
                    console.log('タスク更新成功 - リロード実行中...');
                    await reloadFunction();
                    console.log('リロード完了');
                    
                    this.hideEditDialog();
                    
                    // 報告書ダイアログが開いている場合はタグサマリーも更新
                    const reportDialog = document.getElementById('report-dialog');
                    if (reportDialog && reportDialog.classList.contains('show')) {
                        await this.generateTagSummary();
                    }
                    
                    // 調整があった場合は通知
                    if (result.adjustments && result.adjustments.length > 0) {
                        this.showAdjustmentNotification(result.adjustments);
                    } else {
                        this.showToast('タスクを更新しました');
                    }
                } else {
                    console.error('API成功だが結果がfalse:', result);
                    this.showToast('タスクの更新に失敗しました', 'error');
                }
            }
            else {
                console.error('API response not ok:', response.status);
                this.showToast('タスクの更新に失敗しました', 'error');
            }
        } catch (error) {
            console.error('タスク更新エラー:', error);
            this.showToast('タスクの更新に失敗しました', 'error');
        }
    }

    showAdjustmentNotification(adjustments) {
        let message = 'タスクを更新しました。';
        if (adjustments.length > 0) {
            message += '\n\n時間の重複を解消するため、以下のタスクも調整されました:';
            adjustments.forEach(adj => {
                const taskName = this.tasks[adj.taskId]?.name || `タスク${adj.taskId + 1}`;
                const fieldName = adj.field === 'startTime' ? '開始時間' : '終了時間';
                message += `\n• ${taskName}の${fieldName}: ${adj.oldValue} → ${adj.newValue}`;
            });
        }
        
        // より詳細な通知用のダイアログを表示
        this.showDetailedToast(message, 'success', 6000);
    }

    showDetailedToast(message, type = 'success', duration = 4000) {
        const toast = document.getElementById('toast');
        const messageElement = document.getElementById('toast-message');
        
        // 改行を<br>に変換
        messageElement.innerHTML = message.replace(/\n/g, '<br>');
        
        // タイプに応じて色を変更
        const colors = {
            success: 'var(--success)',
            warning: 'var(--warning)',
            error: 'var(--error)'
        };
        
        toast.style.background = colors[type] || colors.success;
        toast.classList.add('show');
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, duration);
    }

    async deleteCurrentTask() {
        let task = null;
        let taskName = 'タスク';
        
        // 履歴タスクの場合は履歴データから取得
        if (this.editingDate) {
            try {
                console.log('履歴タスクの削除処理開始:', { editingTaskId: this.editingTaskId, editingDate: this.editingDate });
                
                // 履歴データを取得
                const response = await fetch(`${this.apiBaseUrl}/api/history/${this.editingDate}`);
                if (response.ok) {
                    const result = await response.json();
                    if (result.success && result.data && result.data.tasks) {
                        // 履歴データからタスクを検索
                        task = result.data.tasks.find(t => {
                            // まず完全一致を試行
                            if (t.id === this.editingTaskId) {
                                return true;
                            }
                            
                            // 文字列と数値の混在パターンを処理
                            if (typeof t.id === 'string' && typeof this.editingTaskId === 'number') {
                                const match = t.id.match(/\d+/);
                                const taskIdNum = match ? parseInt(match[0]) : null;
                                return taskIdNum === this.editingTaskId;
                            }
                            
                            if (typeof t.id === 'number' && typeof this.editingTaskId === 'string') {
                                const match = this.editingTaskId.match(/\d+/);
                                const editingIdNum = match ? parseInt(match[0]) : null;
                                return t.id === editingIdNum;
                            }
                            
                            return false;
                        });
                        
                        if (task) {
                            taskName = task.name || task.title || 'タスク';
                            console.log('履歴タスクが見つかりました:', task);
                        } else {
                            console.error('履歴データからタスクが見つかりません:', {
                                editingTaskId: this.editingTaskId,
                                availableHistoryTasks: result.data.tasks.map(t => ({ id: t.id, type: typeof t.id, name: t.name || t.title }))
                            });
                        }
                    }
                }
            } catch (error) {
                console.error('履歴データの取得エラー:', error);
            }
        } else {
            // 今日のタスクの場合は既存の処理
            task = this.tasks.find(t => {
                // まず完全一致を試行
                if (t.id === this.editingTaskId) {
                    return true;
                }
                
                // 文字列と数値の混在パターンを処理
                if (typeof t.id === 'string' && typeof this.editingTaskId === 'number') {
                    const match = t.id.match(/\d+/);
                    const taskIdNum = match ? parseInt(match[0]) : null;
                    return taskIdNum === this.editingTaskId;
                }
                
                if (typeof t.id === 'number' && typeof this.editingTaskId === 'string') {
                    const match = this.editingTaskId.match(/\d+/);
                    const editingIdNum = match ? parseInt(match[0]) : null;
                    return t.id === editingIdNum;
                }
                
                return false;
            });
            
            if (task) {
                taskName = task.name || task.title || 'タスク';
            } else {
                console.error('今日のタスクが見つかりません:', {
                    editingTaskId: this.editingTaskId,
                    editingTaskIdType: typeof this.editingTaskId,
                    availableTasks: this.tasks.map(t => ({ id: t.id, type: typeof t.id, name: t.name }))
                });
            }
        }
        
        if (!task) {
            this.showToast('削除対象のタスクが見つかりません', 'error');
            return;
        }

        const dialog = document.getElementById('confirm-dialog');
        const title = document.getElementById('confirm-title');
        const message = document.getElementById('confirm-message');
        
        title.textContent = 'タスクを削除';
        message.textContent = `タスク「${taskName}」を削除しますか？この操作は元に戻せません。`;
        
        // 履歴タスクか今日のタスクかで処理を分ける
        if (this.editingDate) {
            this.pendingAction = 'deleteHistoryTask';
        } else {
            this.pendingAction = 'deleteTask';
        }
        this.pendingTaskId = this.editingTaskId; // IDを保存
        this.pendingDate = this.editingDate; // 日付を保存（履歴タスクの場合）
        this.hideEditDialog();
        dialog.classList.add('show');
    }

    async executeConfirmedAction() {
        if (this.pendingAction === 'clearAll') {
            await this.clearAllTasks();
        } else if (this.pendingAction === 'deleteTask') {
            await this.deleteTask();
        } else if (this.pendingAction === 'deleteHistoryTask') {
            await this.deleteHistoryTask();
        } else if (this.pendingAction === 'deleteReportUrl') {
            await this.executeDeleteReportUrl();
        } else if (this.pendingAction === 'closeReportDialog') {
            this.hideReportDialog();
        } else if (this.pendingAction === 'clearTaskStock') {
            await this.executeClearTaskStock();
        }
        this.hideConfirmDialog();
    }

    async deleteTask() {
        try {
            const taskId = this.pendingTaskId;
            console.log('削除対象タスクID:', taskId); // デバッグ用
            
            if (taskId === null || taskId === undefined) {
                this.showToast('削除対象のタスクが特定できません', 'error');
                return;
            }
            
            const response = await fetch(`${this.apiBaseUrl}/api/tasks/${taskId}`, { method: 'DELETE' });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    await this.loadTasks();
                    
                    // 報告書ダイアログが開いている場合はタグサマリーも更新
                    const reportDialog = document.getElementById('report-dialog');
                    if (reportDialog && reportDialog.classList.contains('show')) {
                        await this.generateTagSummary();
                    }
                    
                    this.showToast('タスクを削除しました');
                } else {
                    this.showToast('タスクの削除に失敗しました', 'error');
                }
            }
        } catch (error) {
            console.error('タスク削除エラー:', error);
            this.showToast('タスクの削除に失敗しました', 'error');
        } finally {
            this.pendingTaskId = null; // クリーンアップ
        }
    }
    
    async deleteHistoryTask() {
        try {
            const taskId = this.pendingTaskId;
            const dateString = this.pendingDate;
            console.log('履歴タスク削除開始:', { 
                taskId, 
                dateString, 
                taskIdType: typeof taskId,
                dateStringType: typeof dateString 
            });
            
            if (taskId === null || taskId === undefined || !dateString) {
                console.error('削除対象のタスクまたは日付が特定できません:', { taskId, dateString });
                this.showToast('削除対象のタスクまたは日付が特定できません', 'error');
                return;
            }
            
            console.log('履歴タスク削除APIを呼び出し中:', `${this.apiBaseUrl}/api/history/${dateString}/tasks/${taskId}`);
            const response = await fetch(`${this.apiBaseUrl}/api/history/${dateString}/tasks/${taskId}`, { method: 'DELETE' });
            
            console.log('履歴タスク削除APIレスポンス:', { status: response.status, ok: response.ok });
            
            if (response.ok) {
                const result = await response.json();
                console.log('履歴タスク削除APIレスポンス内容:', result);
                
                if (result.success) {
                    console.log('履歴タスクの削除に成功、データを再読み込み中...');
                    // 履歴データを再読み込み
                    await this.loadHistoryData(dateString);
                    
                    // 報告書ダイアログが開いている場合はタグサマリーも更新
                    const reportDialog = document.getElementById('report-dialog');
                    if (reportDialog && reportDialog.classList.contains('show')) {
                        await this.generateTagSummary();
                    }
                    
                    this.showToast('履歴タスクを削除しました');
                } else {
                    console.error('履歴タスクの削除に失敗:', result);
                    this.showToast(result.message || '履歴タスクの削除に失敗しました', 'error');
                }
            } else {
                const errorText = await response.text();
                console.error('履歴タスク削除APIエラー:', { status: response.status, statusText: response.statusText, errorText });
                this.showToast(`履歴タスクの削除に失敗しました (${response.status})`, 'error');
            }
        } catch (error) {
            console.error('履歴タスク削除エラー:', error);
            this.showToast('履歴タスクの削除に失敗しました', 'error');
        } finally {
            console.log('履歴タスク削除処理のクリーンアップ');
            this.pendingTaskId = null; // クリーンアップ
            this.pendingDate = null; // クリーンアップ
        }
    }

    async showReportDialog() {
        // 目標ストックを読み込み
        await this.loadGoalStock();
        
        // 目標サマリーを生成
        this.generateGoalSummary();

        // タスクサマリーを生成
        this.generateTaskSummary();
        
        // タグサマリーを生成
        await this.generateTagSummary();

        // 報告先リンクを生成
        await this.generateReportLinks();

        // タブを生成
        await this.generateReportTabs();

        // 元のコンテンツを保存（変更検知用）
        await this.saveOriginalContent();

        // 変更監視を開始
        this.setupContentChangeListeners();

        // 保存ボタンの初期状態を設定
        this.updateSaveButtonState();
        
        // タイムラインコピーボタンの状態を設定
        this.updateTimelineCopyButtonState();
        
        // クリップボードコピーボタンの状態を設定
        this.updateClipboardCopyButtonState();

        // ダイアログを表示
        const dialog = document.getElementById('report-dialog');
        dialog.classList.add('show');
    }

    handleReportClose() {
        if (this.hasUnsavedChanges) {
            this.showUnsavedChangesDialog();
        } else {
            this.hideReportDialog();
        }
    }

    showUnsavedChangesDialog() {
        const dialog = document.getElementById('confirm-dialog');
        const title = document.getElementById('confirm-title');
        const message = document.getElementById('confirm-message');
        
        title.textContent = '変更が保存されていません';
        message.textContent = '報告書に未保存の変更があります。\n変更を破棄してダイアログを閉じますか？';
        
        this.pendingAction = 'closeReportDialog';
        dialog.classList.add('show');
    }

    hideReportDialog() {
        const dialog = document.getElementById('report-dialog');
        dialog.classList.remove('show');
        this.hasUnsavedChanges = false;
        this.originalReportContent = '';
        this.originalTabContents.clear();
    }

    async saveOriginalContent() {
        this.hasUnsavedChanges = false;
        this.originalReportContent = '';
        this.originalTabContents.clear();
        
        // 報告先がない場合の単一テキストエリア
        if (this.reportUrls.length === 0) {
            const textarea = document.getElementById('single-report-content');
            if (textarea) {
                this.originalReportContent = textarea.value;
            }
        } else {
            // タブ別コンテンツを保存
            for (const url of this.reportUrls) {
                const tabId = url.id.toString();
                const content = await this.getTabContent(tabId);
                this.originalTabContents.set(tabId, content);
            }
        }
    }

    setupContentChangeListeners() {
        // 既存のイベントリスナーを削除してから新しいものを追加
        this.removeContentChangeListeners();
        
        // 報告先がない場合の単一テキストエリア
        if (this.reportUrls.length === 0) {
            const textarea = document.getElementById('single-report-content');
            if (textarea) {
                // 既存のリスナーを削除
                textarea.removeEventListener('input', this.checkForChanges);
                // 新しいリスナーを追加
                textarea.addEventListener('input', () => this.checkForChanges());
            }
        } else {
            // タブ別テキストエリア
            for (const url of this.reportUrls) {
                const tabId = url.id.toString();
                const textarea = document.getElementById(`tab-content-${tabId}`);
                if (textarea) {
                    // 既存のリスナーを削除
                    textarea.removeEventListener('input', this.checkForChanges);
                    // 新しいリスナーを追加
                    textarea.addEventListener('input', () => this.checkForChanges());
                }
            }
        }
    }

    removeContentChangeListeners() {
        // 単一テキストエリアのリスナーを削除
        const singleTextarea = document.getElementById('single-report-content');
        if (singleTextarea) {
            singleTextarea.removeEventListener('input', this.checkForChanges);
        }
        
        // タブ別テキストエリアのリスナーを削除
        if (this.reportUrls && this.reportUrls.length > 0) {
            for (const url of this.reportUrls) {
                const tabId = url.id.toString();
                const textarea = document.getElementById(`tab-content-${tabId}`);
                if (textarea) {
                    textarea.removeEventListener('input', this.checkForChanges);
                }
            }
        }
    }

    checkForChanges() {
        let hasChanges = false;
        
        // 報告先がない場合の単一テキストエリア
        if (this.reportUrls.length === 0) {
            const textarea = document.getElementById('single-report-content');
            if (textarea) {
                hasChanges = textarea.value !== this.originalReportContent;
            }
        } else {
            // タブ別コンテンツをチェック
            for (const url of this.reportUrls) {
                const tabId = url.id.toString();
                const textarea = document.getElementById(`tab-content-${tabId}`);
                if (textarea) {
                    const originalContent = this.originalTabContents.get(tabId) || '';
                    if (textarea.value !== originalContent) {
                        hasChanges = true;
                        break;
                    }
                }
            }
        }
        
        this.hasUnsavedChanges = hasChanges;
        this.updateSaveButtonState();
        this.updateClipboardCopyButtonState();
    }

    updateSaveButtonState() {
        const saveButton = document.getElementById('report-save');
        if (saveButton) {
            if (this.hasUnsavedChanges) {
                saveButton.classList.add('active');
                saveButton.disabled = false;
            } else {
                saveButton.classList.remove('active');
                saveButton.disabled = true;
            }
        }
    }

    updateTimelineCopyButtonState() {
        const timelineCopyButton = document.getElementById('copy-timeline-btn');
        if (timelineCopyButton) {
            // 終了していないタスクがあるかチェック
            const hasRunningTasks = this.tasks.some(task => this.isRunningTask(task));
            
            if (hasRunningTasks) {
                timelineCopyButton.disabled = true;
                timelineCopyButton.classList.add('disabled');
            } else {
                timelineCopyButton.disabled = false;
                timelineCopyButton.classList.remove('disabled');
            }
        }
    }

    updateClipboardCopyButtonState() {
        const clipboardCopyButton = document.getElementById('report-copy');
        if (clipboardCopyButton) {
            // テキストが保存されているかチェック
            const hasContent = this.checkIfReportHasContent();
            // 未保存の変更があるかチェック
            const hasUnsavedChanges = this.hasUnsavedChanges;
            
            // コンテンツがあり、かつ未保存の変更がない場合のみ有効
            if (hasContent && !hasUnsavedChanges) {
                clipboardCopyButton.disabled = false;
                clipboardCopyButton.classList.remove('disabled');
            } else {
                clipboardCopyButton.disabled = true;
                clipboardCopyButton.classList.add('disabled');
            }
        }
    }

    checkIfReportHasContent() {
        // 報告先がない場合の単一テキストエリア
        if (this.reportUrls.length === 0) {
            const textarea = document.getElementById('single-report-content');
            return textarea && textarea.value.trim() !== '';
        } else {
            // タブ別コンテンツをチェック
            const currentTabTextarea = document.getElementById(`tab-content-${this.currentTabId}`);
            return currentTabTextarea && currentTabTextarea.value.trim() !== '';
        }
    }

    generateGoalSummary() {
        const summaryContainer = document.getElementById('goal-summary');
        
        if (!this.goalStock || this.goalStock.length === 0) {
            summaryContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">目標が設定されていません</p>';
            return;
        }

        let summaryHTML = '';
        this.goalStock.forEach((goal, index) => {
            summaryHTML += `<div style="margin-bottom: 8px;">・${goal.name}</div>`;
        });

        summaryContainer.innerHTML = summaryHTML;
    }

    generateTaskSummary() {
        const summaryContainer = document.getElementById('task-summary');
        
        if (this.tasks.length === 0) {
            summaryContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">今日はまだタスクがありません</p>';
            return;
        }

        // 完了したタスクと実行中のタスクを分ける
        const completedTasks = this.tasks.filter(task => task.endTime);
        const runningTasks = this.tasks.filter(task => this.isRunningTask(task));

        let summaryHTML = '';

        // 完了したタスク
        if (completedTasks.length > 0) {
            summaryHTML += '<div style="margin-bottom: 16px;"><strong>✅ 完了したタスク:</strong></div>';
            completedTasks.forEach(task => {
                const duration = this.calculateDuration(task.startTime, task.endTime);
                const timeRange = `${this.formatTime(task.startTime)} - ${this.formatTime(task.endTime)}`;
                
                summaryHTML += `
                    <div class="task-item">
                        <div>
                            <div class="task-item-name">${task.name}</div>
                            <div class="task-item-time">${timeRange}</div>
                        </div>
                        <div class="task-item-duration">${duration}</div>
                    </div>
                `;
            });
        }

        // 実行中のタスク
        if (runningTasks.length > 0) {
            summaryHTML += '<div style="margin: 16px 0 16px 0;"><strong>🔄 実行中のタスク:</strong></div>';
            runningTasks.forEach(task => {
                summaryHTML += `
                    <div class="task-item">
                        <div>
                            <div class="task-item-name">${task.name}</div>
                            <div class="task-item-time">${this.formatTime(task.startTime)} - 実行中</div>
                        </div>
                        <div class="task-item-duration">実行中</div>
                    </div>
                `;
            });
        }

        summaryContainer.innerHTML = summaryHTML;
    }

    async addReservation() {
        // 予約は今日モードのみ
        if (this.currentMode === 'history' || this.currentDate) {
            this.showToast('予約は今日モードでのみ利用できます', 'warning');
            return;
        }

        const taskInput = document.getElementById('task-input');
        const taskTagSelect = document.getElementById('task-tag-select');
        const reserveTimeInput = document.getElementById('reserve-time-input');

        const taskName = (taskInput?.value || '').trim();
        const time24 = (reserveTimeInput?.value || '').trim();
        const selectedTag = taskTagSelect ? taskTagSelect.value : '';

        if (!taskName) {
            this.showToast('タスク名を入力してください', 'warning');
            return;
        }
        if (!time24) {
            this.showToast('開始時刻を指定してください', 'warning');
            return;
        }

        const startTime = this.convertTo12Hour(time24);
        if (!startTime) {
            this.showToast('開始時刻の形式が不正です', 'error');
            return;
        }

        try {
            const requestData = {
                name: taskName,
                tag: selectedTag || null,
                startTime: startTime
            };

            const response = await fetch(`${this.apiBaseUrl}/api/tasks/reserve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            });

            const result = await response.json().catch(() => null);

            if (!response.ok || !result?.success) {
                const message = result?.error || '予約の登録に失敗しました';
                this.showToast(message, 'warning');
                return;
            }

            // 入力をクリア
            if (taskInput) taskInput.value = '';
            if (taskTagSelect) taskTagSelect.selectedIndex = 0;

            await this.loadTasks();
            this.showToast(`${startTime} に「${taskName}」を予約しました`);
        } catch (error) {
            console.error('予約追加エラー:', error);
            this.showToast('予約の登録に失敗しました', 'error');
        }
    }

    async generateTagSummary() {
        const summaryContainer = document.getElementById('tag-summary');
        
        // 全タスクデータを取得（現在の日付 + 全履歴）
        const allTasks = await this.getAllTasksIncludingHistory();
        
        if (allTasks.length === 0) {
            summaryContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">まだタスクがありません</p>';
            return;
        }

        // タグ別作業時間とタスクを計算
        const tagData = new Map();
        
        // 完了したタスクのみを対象とする
        const completedTasks = allTasks.filter(task => task.endTime);
        
        // デバッグ用: 完了したタスクの詳細を確認
        console.log('完了したタスク数:', completedTasks.length);
        console.log('完了したタスクの詳細情報:');
        completedTasks.forEach((task, index) => {
            const taskName = task.name || task.title || 'unnamed task';
            console.log(`タスク${index + 1}:`, JSON.stringify({
                name: taskName,
                tag: task.tag,
                hasTag: !!task.tag,
                tagType: typeof task.tag,
                date: task.date,
                taskKeys: Object.keys(task),
                endTime: task.endTime
            }, null, 2));
        });
        
        completedTasks.forEach(task => {
            // デバッグ用: タスクオブジェクト全体を確認（最初の1件のみ）
            if (completedTasks.indexOf(task) === 0) {
                console.log('最初のタスクオブジェクト全体:', JSON.stringify(task, null, 2));
            }
            
            // タスク名を取得（nameまたはtitleプロパティ）
            const taskName = task.name || task.title || 'unnamed task';
            
            // タグがnull、undefined、空文字の場合はスキップ
            // 他の可能性のあるプロパティ名もチェック
            const tagValue = task.tag || task.tags || task.category || task.type;
            
            if (tagValue && typeof tagValue === 'string' && tagValue.trim() !== '') {
                console.log(`タスク "${taskName}" のタグ値:`, tagValue);
                
                const duration = this.calculateDurationInMinutes(task.startTime, task.endTime);
                if (!tagData.has(tagValue)) {
                    tagData.set(tagValue, {
                        totalMinutes: 0,
                        tasks: []
                    });
                }
                const data = tagData.get(tagValue);
                data.totalMinutes += duration;
                data.tasks.push({
                    name: taskName, // 修正: nameまたはtitleを使用
                    startTime: task.startTime,
                    endTime: task.endTime,
                    duration: this.calculateDuration(task.startTime, task.endTime),
                    date: task.date || 'today' // 日付情報を追加
                });
            } else {
                console.log(`タスク "${taskName}" にはタグがありません。利用可能なプロパティ:`, Object.keys(task));
            }
        });

        // タグ別作業時間が空の場合
        if (tagData.size === 0) {
            summaryContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">タグが設定されたタスクがありません</p>';
            return;
        }

        // デバッグ用: 集計されたタグデータを確認
        console.log('集計されたタグデータ:');
        Array.from(tagData.entries()).forEach(([tagName, data]) => {
            console.log(`タグ: ${tagName}`, JSON.stringify({
                tagName,
                totalMinutes: data.totalMinutes,
                taskCount: data.tasks.length
            }, null, 2));
        });

    // 後でCSV出力等に利用できるように最新のタグ集計データを保持
    this.tagSummaryData = tagData;

        // タグストック順序に従って並び替え
        const tagEntries = Array.from(tagData.entries());
        const sortedTags = this.tagStock.length > 0 
            ? this.tagStock
                .filter(tagItem => tagData.has(tagItem.name))
                .map(tagItem => [tagItem.name, tagData.get(tagItem.name)])
                .concat(tagEntries.filter(([tag, data]) => !this.tagStock.some(tagItem => tagItem.name === tag)))
                .sort((a, b) => {
                    const aInStock = this.tagStock.some(tagItem => tagItem.name === a[0]);
                    const bInStock = this.tagStock.some(tagItem => tagItem.name === b[0]);
                    if (aInStock && bInStock) {
                        const aIndex = this.tagStock.findIndex(tagItem => tagItem.name === a[0]);
                        const bIndex = this.tagStock.findIndex(tagItem => tagItem.name === b[0]);
                        return aIndex - bIndex;
                    } else if (aInStock) {
                        return -1;
                    } else if (bInStock) {
                        return 1;
                    } else {
                        return b[1].totalMinutes - a[1].totalMinutes;
                    }
                })
            : tagEntries.sort((a, b) => b[1].totalMinutes - a[1].totalMinutes);

        // タブナビゲーション生成（スクロールボタン付き）
        let tabsHTML = '<div class="tag-tabs-container">';
        tabsHTML += '<button class="tag-scroll-btn tag-scroll-left" onclick="app.scrollTagTabs(\'left\')" title="左にスクロール">';
        tabsHTML += '<span class="material-icons">chevron_left</span>';
        tabsHTML += '</button>';
        tabsHTML += '<div class="tag-tabs-navigation">';
        let panelsHTML = '<div class="tag-tabs-content">';
        
        sortedTags.forEach(([tagName, tagInfo], index) => {
            const hours = Math.floor(tagInfo.totalMinutes / 60);
            const mins = tagInfo.totalMinutes % 60;
            let durationText = '';
            
            if (hours > 0) {
                durationText = `${hours}時間${mins > 0 ? mins + '分' : ''}`;
            } else {
                durationText = `${mins}分`;
            }
            
            const tabId = `tag-tab-${index}`;
            const panelId = `tag-panel-${index}`;
            const isActive = index === 0 ? ' active' : '';
            
            // タブボタン
            tabsHTML += `
                <button class="tag-tab${isActive}" data-tab="${tabId}" onclick="app.switchTagTab('${tabId}')">
                    ${tagName} (${durationText})
                </button>
            `;
            
            // タブパネル
            panelsHTML += `
                <div class="tag-tab-panel${isActive}" id="${panelId}">`;
            
            // 日付別作業時間の集計を計算
            const dateStats = new Map();
            tagInfo.tasks.forEach(task => {
                const taskDate = task.date === 'today' ? '今日' : task.date;
                if (!dateStats.has(taskDate)) {
                    dateStats.set(taskDate, { totalMinutes: 0, taskCount: 0 });
                }
                const stats = dateStats.get(taskDate);
                stats.totalMinutes += this.calculateDurationInMinutes(task.startTime, task.endTime);
                stats.taskCount += 1;
            });
            
            panelsHTML += `<div class="tag-tasks">`;
            
            // タスク一覧（日付別にソート）
            const sortedTasks = tagInfo.tasks.sort((a, b) => {
                if (a.date === 'today' && b.date !== 'today') return -1;
                if (a.date !== 'today' && b.date === 'today') return 1;
                if (a.date !== 'today' && b.date !== 'today') {
                    return b.date.localeCompare(a.date); // 新しい日付順
                }
                return 0;
            });
            
            let currentDate = '';
            sortedTasks.forEach(task => {
                const taskDate = task.date === 'today' ? '今日' : task.date;
                if (taskDate !== currentDate) {
                    if (currentDate !== '') {
                        panelsHTML += '<div class="date-separator"></div>';
                    }
                    
                    // その日の合計時間を取得
                    const dayStats = dateStats.get(taskDate);
                    let dayTotalText = '';
                    if (dayStats) {
                        const hours = Math.floor(dayStats.totalMinutes / 60);
                        const mins = dayStats.totalMinutes % 60;
                        
                        if (hours > 0) {
                            dayTotalText = `${hours}時間${mins > 0 ? mins + '分' : ''}`;
                        } else {
                            dayTotalText = `${mins}分`;
                        }
                    }
                    
                    panelsHTML += `
                        <div class="date-header-with-stats">
                            <div class="date-header">${taskDate}</div>
                            <div class="date-total">${dayTotalText} (${dayStats ? dayStats.taskCount : 0}件)</div>
                        </div>
                    `;
                    currentDate = taskDate;
                }
                
                const timeRange = `${this.formatTime(task.startTime)} - ${this.formatTime(task.endTime)}`;
                panelsHTML += `
                    <div class="task-item">
                        <div>
                            <div class="task-item-name">${task.name}</div>
                            <div class="task-item-time">${timeRange}</div>
                        </div>
                        <div class="task-item-duration">${task.duration}</div>
                    </div>
                `;
            });
            
            panelsHTML += `
                    </div>
                    <div class="tag-total">
                        <span>合計: ${durationText} (履歴含む)</span>
                        <div class="tag-total-actions">
                            <button class="tag-copy-btn" onclick="app.copyTagSummary('${tagName}', '${durationText}')" title="タグ名と時間をコピー">
                                <span class="material-icons">content_copy</span>
                                コピー
                            </button>
                            <button class="tag-copy-btn tag-csv-btn" onclick="app.exportTagCsv('${tagName}')" title="このタグのタスクをCSV出力 (作業日,作業内容,作業開始時刻,作業終了時刻)">
                                <span class="material-icons">download</span>
                                CSV
                            </button>
                        </div>
                    </div>
                </div>
            `;
        });
        
        tabsHTML += '</div>'; // tag-tabs-navigation終了
        tabsHTML += '<button class="tag-scroll-btn tag-scroll-right" onclick="app.scrollTagTabs(\'right\')" title="右にスクロール">';
        tabsHTML += '<span class="material-icons">chevron_right</span>';
        tabsHTML += '</button>';
        tabsHTML += '</div>'; // tag-tabs-container終了
        panelsHTML += '</div>';
        
        summaryContainer.innerHTML = tabsHTML + panelsHTML;
        
        // スクロールボタンの表示/非表示を設定
        this.updateTagScrollButtons();
    }

    // 全てのタスクデータを取得（現在の日付 + 全履歴）
    async getAllTasksIncludingHistory() {
        try {
            let allTasks = [];
            
            // 現在のタスクを追加（今日モードの場合）
            if (this.currentMode === 'today') {
                allTasks = [...this.tasks.map(task => ({ ...task, date: 'today' }))];
                console.log('今日モードのタスクを追加:', allTasks.length, '件');
            }
            
            // 全履歴データを取得
            const historyResponse = await fetch(`${this.apiBaseUrl}/api/history/dates`);
            if (historyResponse.ok) {
                const historyResult = await historyResponse.json();
                
                if (historyResult.success && historyResult.dates.length > 0) {
                    for (const dateString of historyResult.dates) {
                        const dayResponse = await fetch(`${this.apiBaseUrl}/api/history/${dateString}`);
                        if (dayResponse.ok) {
                            const dayResult = await dayResponse.json();
                            if (dayResult.success && dayResult.data && dayResult.data.tasks) {
                                const historyTasks = dayResult.data.tasks.map(task => ({
                                    ...task,
                                    date: dateString
                                }));
                                allTasks = [...allTasks, ...historyTasks];
                                console.log(`履歴データ追加 ${dateString}:`, historyTasks.length, '件');
                            }
                        }
                    }
                }
            }
            
            // デバッグ用: 取得したタスクの詳細を確認
            console.log(`全タスクデータ取得完了: ${allTasks.length}件（履歴含む）`);
            console.log('取得したタスクの詳細:');
            allTasks.forEach((task, index) => {
                if (index < 5) { // 最初の5件のみ詳細表示
                    const taskName = task.name || task.title || 'unnamed task';
                    console.log(`タスク${index + 1}:`, JSON.stringify({
                        name: taskName,
                        tag: task.tag,
                        date: task.date,
                        endTime: task.endTime,
                        taskKeys: Object.keys(task)
                    }, null, 2));
                }
            });
            
            return allTasks;
        } catch (error) {
            console.error('全タスクデータ取得エラー:', error);
            return this.tasks; // エラー時は現在のタスクのみ返す
        }
    }

    // タグタブ切り替え機能
    switchTagTab(targetTabId) {
        // すべてのタブとパネルから active クラスを削除
        document.querySelectorAll('.tag-tab').forEach(tab => tab.classList.remove('active'));
        document.querySelectorAll('.tag-tab-panel').forEach(panel => panel.classList.remove('active'));
        
        // 選択されたタブとパネルに active クラスを追加
        const targetTab = document.querySelector(`[data-tab="${targetTabId}"]`);
        const targetPanel = document.getElementById(targetTabId.replace('tab', 'panel'));
        
        if (targetTab && targetPanel) {
            targetTab.classList.add('active');
            targetPanel.classList.add('active');
            
            // アクティブなタブをビューポートの中央にスムーズスクロール
            this.scrollTagTabIntoView(targetTab);
        }
    }

    // タグタブをビューポート内にスクロールする機能
    scrollTagTabIntoView(tabElement) {
        const navigation = document.querySelector('.tag-tabs-navigation');
        if (!navigation || !tabElement) return;

        // タブの位置とナビゲーションの情報を取得
        const tabRect = tabElement.getBoundingClientRect();
        const navRect = navigation.getBoundingClientRect();
        const scrollLeft = navigation.scrollLeft;

        // タブがナビゲーション領域外にある場合にスクロール
        const tabLeftRelative = tabElement.offsetLeft;
        const tabRightRelative = tabLeftRelative + tabElement.offsetWidth;
        const visibleLeft = scrollLeft;
        const visibleRight = scrollLeft + navigation.clientWidth;

        let scrollTo = scrollLeft;

        if (tabLeftRelative < visibleLeft) {
            // タブが左側に隠れている場合、左端に合わせる
            scrollTo = tabLeftRelative - 10; // 少し余裕を持たせる
        } else if (tabRightRelative > visibleRight) {
            // タブが右側に隠れている場合、右端に合わせる
            scrollTo = tabRightRelative - navigation.clientWidth + 10; // 少し余裕を持たせる
        }

        // スムーズスクロールを実行
        if (scrollTo !== scrollLeft) {
            navigation.scrollTo({
                left: scrollTo,
                behavior: 'smooth'
            });
        }
    }

    // タグタブのスクロール機能
    scrollTagTabs(direction) {
        const navigation = document.querySelector('.tag-tabs-navigation');
        if (!navigation) return;

        const scrollAmount = 200; // スクロール量（ピクセル）
        const currentScroll = navigation.scrollLeft;
        
        if (direction === 'left') {
            navigation.scrollTo({
                left: Math.max(0, currentScroll - scrollAmount),
                behavior: 'smooth'
            });
        } else {
            navigation.scrollTo({
                left: currentScroll + scrollAmount,
                behavior: 'smooth'
            });
        }

        // スクロール後にボタンの表示状態を更新
        setTimeout(() => this.updateTagScrollButtons(), 100);
    }

    // タグスクロールボタンの表示/非表示を更新
    updateTagScrollButtons() {
        const navigation = document.querySelector('.tag-tabs-navigation');
        const leftBtn = document.querySelector('.tag-scroll-left');
        const rightBtn = document.querySelector('.tag-scroll-right');
        
        if (!navigation || !leftBtn || !rightBtn) return;

        const canScrollLeft = navigation.scrollLeft > 0;
        const canScrollRight = navigation.scrollLeft < (navigation.scrollWidth - navigation.clientWidth);

        leftBtn.style.display = canScrollLeft ? 'flex' : 'none';
        rightBtn.style.display = canScrollRight ? 'flex' : 'none';
    }

    // タグサマリーをコピーする機能
    async copyTagSummary(tagName, duration) {
        const copyText = `${tagName} - ${duration}`;
        
        try {
            await navigator.clipboard.writeText(copyText);
            this.showToast(`「${copyText}」をコピーしました`, 'success');
        } catch (error) {
            console.error('コピーエラー:', error);
            this.showToast('コピーに失敗しました', 'error');
        }
    }

    // タグ別CSVエクスポート
    exportTagCsv(tagName) {
        if (!this.tagSummaryData || !this.tagSummaryData.has(tagName)) {
            this.showToast('CSV出力対象のタグデータがありません', 'error');
            return;
        }

        const tasks = this.tagSummaryData.get(tagName).tasks;
        if (!tasks || tasks.length === 0) {
            this.showToast('このタグのタスクがありません', 'error');
            return;
        }

        // 今日の日付を取得（YYYY-MM-DD）
        const today = new Date();
        const localDateParts = today.toLocaleDateString('ja-JP', {
            year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Tokyo'
        }).split('/');
        const todayStr = `${localDateParts[0]}-${localDateParts[1]}-${localDateParts[2]}`;

        // CSVヘッダー
        const headers = ['作業日', '作業内容', '作業開始時刻', '作業終了時刻'];
        const lines = [headers.join(',')];

        const escape = (value) => {
            if (value == null) return '';
            const str = String(value).replace(/"/g, '""');
            return `"${str}"`;
        };

        // 午前/午後 h:mm を 24時間 HH:MM へ変換
        const to24h = (jpTime) => {
            if (!jpTime) return '';
            // 既に HH:MM 形式ならそのまま
            if (/^\d{2}:\d{2}$/.test(jpTime)) return jpTime;
            const m = jpTime.match(/(午前|午後)\s*(\d{1,2}):(\d{2})/);
            if (!m) return jpTime; // 想定外形式はそのまま
            let hour = parseInt(m[2], 10);
            const minute = m[3];
            if (m[1] === '午前') {
                if (hour === 12) hour = 0; // 午前12時 = 00時
            } else { // 午後
                if (hour !== 12) hour += 12; // 午後12時は12時のまま
            }
            return `${hour.toString().padStart(2,'0')}:${minute}`;
        };

        tasks.forEach(t => {
            // 出力用日付（内部は YYYY-MM-DD 想定だが CSV では YYYY/MM/DD を求められている）
            const rawDate = (t.date === 'today' || t.date === '今日') ? todayStr : t.date;
            const date = rawDate ? rawDate.replace(/-/g, '/') : '';
            const row = [
                escape(date),
                escape(t.name || t.title || ''),
                escape(to24h(t.startTime)),
                escape(to24h(t.endTime))
            ];
            lines.push(row.join(','));
        });

        const csv = lines.join('\n');
        try {
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const timestamp = todayStr.replace(/-/g, '');
            a.href = url;
            a.download = `tag_${tagName}_${timestamp}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            this.showToast(`「${tagName}」のCSVを出力しました`, 'success');
        } catch (error) {
            console.error('CSV出力エラー:', error);
            this.showToast('CSV出力に失敗しました', 'error');
        }
    }

    async copyReport() {
        const reportContent = document.getElementById('report-content').value;
        
        try {
            await navigator.clipboard.writeText(reportContent);
            this.showToast('報告書をクリップボードにコピーしました');
        } catch (error) {
            console.error('コピーエラー:', error);
            this.showToast('コピーに失敗しました', 'error');
        }
    }

    async generateReportLinks() {
        const linksContainer = document.getElementById('report-links');
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/report-urls`);
            if (response.ok) {
                const result = await response.json();
                if (result.success && result.urls && result.urls.length > 0) {
                    const linksHTML = result.urls.map(url => `
                        <button class="report-link-btn" onclick="app.openReportUrl('${url.url}')">
                            <span class="material-icons">open_in_new</span>
                            ${url.name}
                        </button>
                    `).join('');
                    linksContainer.innerHTML = linksHTML;
                } else {
                    linksContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 16px;">報告先が設定されていません</p>';
                }
            }
        } catch (error) {
            console.error('報告先URL取得エラー:', error);
            linksContainer.innerHTML = '<p style="color: var(--error); text-align: center; padding: 16px;">報告先の読み込みに失敗しました</p>';
        }
    }

    async openReportUrl(url) {
        try {
            if (this.isWebMode()) {
                window.open(url, '_blank', 'noopener');
                this.showToast('ブラウザで開きました');
                return;
            }

            const result = await (await fetch(`${this.apiBaseUrl}/api/open-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })).json();
            if (result.success) {
                this.showToast('ブラウザで開きました');
            } else {
                this.showToast('URLを開けませんでした', 'error');
            }
        } catch (error) {
            console.error('URL開きエラー:', error);
            this.showToast('URLを開けませんでした', 'error');
        }
    }

    async generateReportTabs() {
        const tabNavigation = document.getElementById('tab-navigation');
        const tabContent = document.getElementById('tab-content');
        
        try {
            // 報告先URLを取得
            const response = await fetch(`${this.apiBaseUrl}/api/report-urls`);
            if (response.ok) {
                const urlResult = await response.json();
                if (urlResult.success) {
                    this.reportUrls = urlResult.urls || [];
                } else {
                    this.reportUrls = [];
                }
            } else {
                this.reportUrls = [];
            }

            // 報告先がない場合は単一のテキストエリアを表示
            if (this.reportUrls.length === 0) {
                tabNavigation.innerHTML = '';
                
                // 既存の報告書データを読み込み
                let existingContent = '';
                try {
                    const reportResponse = await fetch(`${this.apiBaseUrl}/api/report`);
                    if (reportResponse.ok) {
                        const result = await reportResponse.json();
                        if (result.success) {
                            existingContent = result.content;
                        }
                    }
                } catch (error) {
                    console.error('既存報告書読み込みエラー:', error);
                }
                
                tabContent.innerHTML = `
                    <textarea class="tab-textarea" id="single-report-content" placeholder="今日の作業について詳しく記述してください...&#10;&#10;■ 完了した作業&#10;- &#10;&#10;■ 進行中の作業&#10;- &#10;&#10;■ 明日の予定&#10;- &#10;&#10;■ 課題・連絡事項&#10;- ">${existingContent}</textarea>
                `;
                
                // コンテンツが追加された後に変更監視を設定
                setTimeout(() => {
                    this.setupContentChangeListeners();
                }, 100);
                return;
            }

            // 最初の報告先をデフォルトのアクティブタブに設定
            if (!this.currentTabId || !this.reportUrls.find(url => url.id.toString() === this.currentTabId)) {
                this.currentTabId = this.reportUrls[0].id.toString();
            }

            // タブナビゲーションを生成
            let tabsHTML = '';

            // 報告先ごとのタブ
            this.reportUrls.forEach(url => {
                const isActive = this.currentTabId === url.id.toString();
                tabsHTML += `
                    <button class="tab-button ${isActive ? 'active' : ''}" 
                            onclick="app.switchTab('${url.id}')">
                        ${url.name}
                    </button>
                `;
            });

            // タブパネルを生成
            await this.generateTabPanels();

            tabNavigation.innerHTML = tabsHTML;
        } catch (error) {
            console.error('タブ生成エラー:', error);
            tabNavigation.innerHTML = '<p style="color: var(--error); text-align: center; padding: 16px;">タブの読み込みに失敗しました</p>';
        }
    }

    async generateTabPanels() {
        const tabContent = document.getElementById('tab-content');
        let contentHTML = '';

        // 報告先ごとのパネル
        for (const url of this.reportUrls) {
            const content = await this.getTabContent(url.id.toString());
            const isActive = this.currentTabId === url.id.toString();
            contentHTML += `
                <div class="tab-panel ${isActive ? 'active' : ''}" id="tab-panel-${url.id}">
                    <textarea class="tab-textarea" id="tab-content-${url.id}" placeholder="${url.name}向けの報告内容を記述してください...">${content}</textarea>
                </div>
            `;
        }

        tabContent.innerHTML = contentHTML;
        
        // コンテンツが追加された後に変更監視を設定
        setTimeout(() => {
            this.setupContentChangeListeners();
        }, 100);
    }

    async getTabContent(tabId) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/report-tabs/${tabId}`);
            if (response.ok) {
                const result = await response.json();
                return result.success ? result.content : '';
            }
            return '';
        } catch (error) {
            console.error(`タブ${tabId}の内容取得エラー:`, error);
            return '';
        }
    }

    async switchTab(tabId) {
        // 現在のタブの内容を保存
        await this.saveCurrentTabContent();

        // タブを切り替え
        this.currentTabId = tabId.toString();

        // UI更新
        this.updateTabUI();
    }

    async saveCurrentTabContent() {
        const textarea = document.getElementById(`tab-content-${this.currentTabId}`);
        if (textarea) {
            try {
                await fetch(`${this.apiBaseUrl}/api/report-tabs/${this.currentTabId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: textarea.value }) });
            } catch (error) {
                console.error('タブ内容保存エラー:', error);
            }
        }
    }

    updateTabUI() {
        // タブボタンのアクティブ状態を更新
        document.querySelectorAll('.tab-button').forEach(button => {
            button.classList.remove('active');
        });
        
        const activeButton = document.querySelector(`[onclick="app.switchTab('${this.currentTabId}')"]`);
        if (activeButton) {
            activeButton.classList.add('active');
        }

        // タブパネルの表示を更新
        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.remove('active');
        });
        
        const activePanel = document.getElementById(`tab-panel-${this.currentTabId}`);
        if (activePanel) {
            activePanel.classList.add('active');
        }
        
        // タブ切り替え時にボタン状態を更新
        this.updateClipboardCopyButtonState();
    }

    async saveReport() {
        // 報告先がない場合は単一のテキストエリアから保存
        if (this.reportUrls.length === 0) {
            const textarea = document.getElementById('single-report-content');
            if (textarea) {
                try {
                    const response = await fetch(`${this.apiBaseUrl}/api/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: textarea.value }) });
                    if (response.ok) {
                        const result = await response.json();
                        if (result.success) {
                            this.showToast('報告書を保存しました');
                            // 保存後に変更フラグをリセット
                            this.hasUnsavedChanges = false;
                            this.updateSaveButtonState();
                            this.updateClipboardCopyButtonState();
                            // 元のコンテンツを更新
                            this.originalReportContent = document.getElementById('single-report-content').value;
                        } else {
                            this.showToast('報告書の保存に失敗しました', 'error');
                        }
                    }
                } catch (error) {
                    console.error('報告書保存エラー:', error);
                    this.showToast('報告書の保存に失敗しました', 'error');
                }
            }
            return;
        }

        // タブの内容を保存
        await this.saveCurrentTabContent();
        
        // 保存後に変更フラグをリセット
        this.hasUnsavedChanges = false;
        this.updateSaveButtonState();
        this.updateClipboardCopyButtonState();
        
        // 元のコンテンツを更新
        for (const url of this.reportUrls) {
            const tabId = url.id.toString();
            const textarea = document.getElementById(`tab-content-${tabId}`);
            if (textarea) {
                this.originalTabContents.set(tabId, textarea.value);
            }
        }
        
        this.showToast('報告書を保存しました');
    }

    async copyReport() {
        // 報告先がない場合は単一のテキストエリアからコピー
        if (this.reportUrls.length === 0) {
            const textarea = document.getElementById('single-report-content');
            if (textarea) {
                try {
                    await navigator.clipboard.writeText(textarea.value);
                    this.showToast('クリップボードにコピーしました');
                } catch (error) {
                    console.error('コピーエラー:', error);
                    this.showToast('コピーに失敗しました', 'error');
                }
            }
            return;
        }

        // 現在のタブの内容をコピー
        const textarea = document.getElementById(`tab-content-${this.currentTabId}`);
        if (textarea) {
            try {
                await navigator.clipboard.writeText(textarea.value);
                this.showToast('クリップボードにコピーしました');
            } catch (error) {
                console.error('コピーエラー:', error);
                this.showToast('コピーに失敗しました', 'error');
            }
        }
    }

    async copyGoals() {
        // 目標ストックを読み込み
        await this.loadGoalStock();
        
        if (!this.goalStock || this.goalStock.length === 0) {
            this.showToast('コピーできる目標がありません', 'warning');
            return;
        }

        // 目標を・目標１、・目標２の形式でコピー
        const goalText = this.goalStock.map((goal, index) => {
            return `・${goal.name}`;
        }).join('\n');

        try {
            await navigator.clipboard.writeText(goalText);
            this.showToast('目標をクリップボードにコピーしました');
        } catch (error) {
            console.error('目標コピーエラー:', error);
            this.showToast('目標のコピーに失敗しました', 'error');
        }
    }

    async openSettingsDialog() {
        // URL一覧を読み込み
        await this.loadReportUrls();

        // 設定を読み込み（ダイアログ表示前に実行）
        await this.loadSettings();

        // ダイアログを表示
        const dialog = document.getElementById('settings-dialog');
        dialog.classList.add('show');

        // 丸めプレビューを初期化/更新
        this.updateRoundingPreview();
        const intervalEl = document.getElementById('time-rounding-interval');
        const modeEl = document.getElementById('time-rounding-mode');
        if (intervalEl && modeEl) {
            const onChange = () => this.updateRoundingPreview();
            intervalEl.removeEventListener('change', onChange);
            modeEl.removeEventListener('change', onChange);
            intervalEl.addEventListener('change', onChange);
            modeEl.addEventListener('change', onChange);
        }
    }

    closeSettingsDialog() {
        const dialog = document.getElementById('settings-dialog');
        dialog.classList.remove('show');
    }
    
    async loadSettings() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/settings`);
            const result = await response.json();
            const settings = result?.settings || {};
            this.settings = settings;
            
            // UI要素に設定を反映
            const roundingInterval = document.getElementById('time-rounding-interval');
            const roundingMode = document.getElementById('time-rounding-mode');

            if (roundingInterval) {
                roundingInterval.value = String(settings.timeRounding?.interval ?? 0);
            }
            if (roundingMode) {
                roundingMode.value = settings.timeRounding?.mode || 'nearest';
            }
            
        } catch (error) {
            console.error('設定の読み込みエラー:', error);
            this.showToast('設定の読み込みに失敗しました', 'error');
        }
    }
    
    async saveSettings() {
        try {
            const roundingInterval = parseInt(document.getElementById('time-rounding-interval')?.value ?? '0', 10);
            const roundingMode = document.getElementById('time-rounding-mode')?.value || 'nearest';
            
            const settings = {
                ...this.settings,
                timeRounding: {
                    interval: isNaN(roundingInterval) ? 0 : roundingInterval,
                    mode: roundingMode
                }
            };

            // Electron由来の設定はWebでは無効のため、保存時に削除してクリーンアップ
            delete settings.globalHotkey;
            delete settings.launchOnStartup;
            
            const response = await fetch(`${this.apiBaseUrl}/api/settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings })
            });
            const result = await response.json();
            const ok = !!result?.success;

            if (ok) {
                this.settings = settings;
                this.showToast('設定を保存しました');
                this.updateRoundingPreview();
            } else {
                this.showToast('設定の保存に失敗しました', 'error');
            }
        } catch (error) {
            console.error('設定の保存エラー:', error);
            this.showToast('設定の保存に失敗しました', 'error');
        }
    }

    updateRoundingPreview() {
        const preview = document.getElementById('time-rounding-preview');
        const interval = parseInt(document.getElementById('time-rounding-interval')?.value || '0', 10);
        const mode = document.getElementById('time-rounding-mode')?.value || 'nearest';
        if (!preview) return;
        const now = new Date();
        const hh = now.getHours().toString().padStart(2, '0');
        const mm = now.getMinutes().toString().padStart(2, '0');
        let rounded = new Date(now);
        if (interval > 0) {
            const minutes = rounded.getMinutes();
            const rem = minutes % interval;
            let adj = minutes;
            if (mode === 'floor') adj = minutes - rem;
            else if (mode === 'ceil') adj = rem === 0 ? minutes : minutes + (interval - rem);
            else adj = rem < interval / 2 ? minutes - rem : minutes + (interval - rem);
            rounded.setSeconds(0, 0);
            rounded.setMinutes(adj);
        }
        const rh = rounded.getHours().toString().padStart(2, '0');
        const rm = rounded.getMinutes().toString().padStart(2, '0');
        preview.textContent = `例: 現在 ${hh}:${mm} → 丸め後 ${rh}:${rm}`;
    }

    async loadReportUrls() {
        const urlList = document.getElementById('url-list');
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/report-urls`);
            if (response.ok) {
                const result = await response.json();
                if (result.success && result.urls && result.urls.length > 0) {
                    const urlsHTML = result.urls.map(url => `
                        <div class="url-item">
                            <div class="url-info">
                                <div class="url-name">${url.name}</div>
                                <div class="url-address">${url.url}</div>
                            </div>
                            <div class="url-actions">
                                <button class="delete" onclick="app.confirmDeleteReportUrl('${url.id}')" title="削除">
                                    <span class="material-icons">delete</span>
                                </button>
                            </div>
                        </div>
                    `).join('');
                    urlList.innerHTML = urlsHTML;
                } else {
                    urlList.innerHTML = `
                        <div class="url-list-empty">
                            <span class="material-icons">link_off</span>
                            <div>報告先が設定されていません</div>
                            <div style="font-size: 12px; opacity: 0.8;">新しい報告先を追加してください</div>
                        </div>
                    `;
                }
            }
        } catch (error) {
            console.error('報告先URL取得エラー:', error);
            urlList.innerHTML = `
                <div class="url-list-empty">
                    <span class="material-icons">error_outline</span>
                    <div style="color: var(--error);">報告先の読み込みに失敗しました</div>
                    <div style="font-size: 12px; opacity: 0.8;">再度お試しください</div>
                </div>
            `;
        }
    }

    async addReportUrl() {
        const nameInput = document.getElementById('url-name-input');
        const urlInput = document.getElementById('url-address-input');
        
        const name = nameInput.value.trim();
        const url = urlInput.value.trim();

        if (!name || !url) {
            this.showToast('名前とURLを入力してください', 'warning');
            return;
        }

        try {
            const response = await fetch(`${this.apiBaseUrl}/api/report-urls`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, url }) });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    nameInput.value = '';
                    urlInput.value = '';
                    await this.loadReportUrls();
                    this.showToast('報告先を追加しました');
                } else {
                    this.showToast('報告先の追加に失敗しました', 'error');
                }
            }
        } catch (error) {
            console.error('報告先追加エラー:', error);
            this.showToast('報告先の追加に失敗しました', 'error');
        }
    }

    confirmDeleteReportUrl(urlId) {
        const dialog = document.getElementById('confirm-dialog');
        const title = document.getElementById('confirm-title');
        const message = document.getElementById('confirm-message');
        
        title.textContent = '報告先を削除';
        message.textContent = 'この報告先を削除しますか？';
        
        this.pendingAction = 'deleteReportUrl';
        this.pendingUrlId = urlId;
        dialog.classList.add('show');
    }

    async executeDeleteReportUrl() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/report-urls/${this.pendingUrlId}`, { method: 'DELETE' });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    await this.loadReportUrls();
                    this.showToast('報告先を削除しました');
                } else {
                    this.showToast('報告先の削除に失敗しました', 'error');
                }
            }
        } catch (error) {
            console.error('報告先削除エラー:', error);
            this.showToast('報告先の削除に失敗しました', 'error');
        } finally {
            this.pendingUrlId = null;
        }
    }

    showGoalStockDialog() {
        const dialog = document.getElementById('goal-stock-dialog');
        dialog.classList.add('show');
        this.loadGoalStock();
        // ダイアログ表示後にドラッグ&ドロップを初期化
        setTimeout(() => this.initGoalStockDragDrop(), 100);
    }

    hideGoalStockDialog() {
        if (this.hasGoalStockChanges) {
            const result = confirm('保存されていない変更があります。変更を破棄して閉じますか？');
            if (!result) {
                return; // キャンセルされた場合は閉じない
            }
        }
        
        const dialog = document.getElementById('goal-stock-dialog');
        dialog.classList.remove('show');
        this.hasGoalStockChanges = false;
        
        // 編集中のアイテムを元に戻す
        this.tempGoalStock = JSON.parse(JSON.stringify(this.goalStock));
        this.renderGoalStock();
    }

    async loadGoalStock() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/goals`);
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.goalStock = result.goals;
                    this.tempGoalStock = JSON.parse(JSON.stringify(this.goalStock)); // ディープコピー
                    this.renderGoalStock();
                }
            }
        } catch (error) {
            console.error('目標ストック読み込みエラー:', error);
        }
    }

    renderGoalStock() {
        const list = document.getElementById('goal-stock-list');
        list.innerHTML = '';
        
        this.tempGoalStock.forEach((goal, index) => {
            const item = document.createElement('div');
            item.className = 'goal-stock-item';
            item.draggable = true;
            item.setAttribute('data-index', index);
            item.innerHTML = `
                <div class="goal-stock-content">
                    <div class="goal-stock-item-drag-handle" title="ドラッグして並び替え">
                        <span class="material-icons">drag_indicator</span>
                    </div>
                    <div class="goal-stock-item-name" title="目標名">${goal.name}</div>
                    <input type="text" value="${goal.name}" class="goal-stock-edit-input" oninput="app.onGoalInputChange(${index}, this)" style="display: none;">
                    <button class="goal-stock-edit-btn" onclick="app.editGoalStockItem(${index})" title="編集">
                        <span class="material-icons">edit</span>
                    </button>
                    <button onclick="app.removeTempGoal(${index})" title="削除">
                        <span class="material-icons">delete</span>
                    </button>
                </div>
            `;
            list.appendChild(item);
        });
        
        this.updateGoalStockSaveButton();
    }

    onGoalInputChange(index, inputElement) {
        const originalValue = inputElement.dataset.originalValue || this.tempGoalStock[index].name;
        const currentValue = inputElement.value.trim();
        
        if (currentValue !== originalValue) {
            this.tempGoalStock[index].name = currentValue;
            this.hasGoalStockChanges = true;
            this.updateGoalStockSaveButton();
            
            // 表示名も更新
            const list = document.getElementById('goal-stock-list');
            const item = list.querySelectorAll('.goal-stock-item')[index];
            const nameDiv = item.querySelector('.goal-stock-item-name');
            nameDiv.textContent = currentValue;
        }
    }

    editGoalStockItem(index) {
        const list = document.getElementById('goal-stock-list');
        const item = list.querySelectorAll('.goal-stock-item')[index];
        const nameDiv = item.querySelector('.goal-stock-item-name');
        const input = item.querySelector('.goal-stock-edit-input');
        const editBtn = item.querySelector('.goal-stock-edit-btn');
        
        if (input.style.display === 'none') {
            // 編集モードに切り替え
            nameDiv.style.display = 'none';
            input.style.display = 'block';
            input.focus();
            input.select();
            editBtn.innerHTML = '<span class="material-icons">check</span>';
            editBtn.title = '入力終了';
            
            // 編集前の値を保存
            input.dataset.originalValue = this.tempGoalStock[index].name;
        } else {
            // 入力終了：表示モードに戻る
            nameDiv.style.display = 'block';
            input.style.display = 'none';
            editBtn.innerHTML = '<span class="material-icons">edit</span>';
            editBtn.title = '編集';
        }
    }

    addGoalStock() {
        const input = document.getElementById('goal-stock-input');
        const name = input.value.trim();
        if (name) {
            this.tempGoalStock.push({ name });
            input.value = '';
            this.hasGoalStockChanges = true;
            this.renderGoalStock();
        }
    }

    updateTempGoal(index, newName) {
        this.tempGoalStock[index].name = newName;
        this.hasGoalStockChanges = true;
        this.updateGoalStockSaveButton();
    }

    removeTempGoal(index) {
        this.tempGoalStock.splice(index, 1);
        this.hasGoalStockChanges = true;
        this.renderGoalStock();
    }

    updateGoalStockSaveButton() {
        const saveBtn = document.getElementById('save-goal-stock-btn');
        saveBtn.disabled = !this.hasGoalStockChanges;
    }

    finishAllGoalEditing() {
        const list = document.getElementById('goal-stock-list');
        const items = list.querySelectorAll('.goal-stock-item');
        
        items.forEach(item => {
            const nameDiv = item.querySelector('.goal-stock-item-name');
            const input = item.querySelector('.goal-stock-edit-input');
            const editBtn = item.querySelector('.goal-stock-edit-btn');
            
            if (input && input.style.display !== 'none') {
                // 編集モードを終了
                nameDiv.style.display = 'block';
                input.style.display = 'none';
                editBtn.innerHTML = '<span class="material-icons">edit</span>';
                editBtn.title = '編集';
            }
        });
    }

    async saveGoalStockChanges() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/goals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goals: this.tempGoalStock }) });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.goalStock = this.tempGoalStock;
                    this.hasGoalStockChanges = false;
                    this.updateGoalStockSaveButton();
                    
                    // 編集モードを終了
                    this.finishAllGoalEditing();
                    
                    this.showToast('目標ストックを保存しました');
                }
            }
        } catch (error) {
            console.error('目標ストック保存エラー:', error);
            this.showToast('目標ストックの保存に失敗しました', 'error');
        }
    }

    async showTaskStockDialog() {
        const dialog = document.getElementById('task-stock-dialog');
        dialog.classList.add('show');
        
        // データを再読み込みしてからレンダリング
        await this.loadTaskStock();
        this.renderTaskStock();
        
        // ダイアログ表示後にドラッグ&ドロップを初期化
        setTimeout(() => this.initTaskStockDragDrop(), 100);
    }

    hideTaskStockDialog() {
        if (this.hasTaskStockChanges) {
            const result = confirm('保存されていない変更があります。変更を破棄して閉じますか？');
            if (!result) {
                return; // キャンセルされた場合は閉じない
            }
        }
        
        const dialog = document.getElementById('task-stock-dialog');
        dialog.classList.remove('show');
        this.hasTaskStockChanges = false;
        
        // 編集中のアイテムを元に戻す（文字列配列として確保）
        this.tempTaskStock = this.taskStock.map(item => {
            if (typeof item === 'string') {
                return item;
            } else if (item && typeof item === 'object' && item.name) {
                return item.name;
            } else {
                return String(item);
            }
        });
        this.renderTaskStock();
    }

    async loadTaskStock() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/task-stock`);
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.taskStock = result.tasks || [];
                    
                    console.log('読み込み前のtaskStock:', this.taskStock);
                    
                    // データがオブジェクト形式の場合は文字列配列に変換
                    this.taskStock = this.taskStock.map(item => {
                        if (typeof item === 'string') {
                            return item;
                        } else if (item && typeof item === 'object' && item.name) {
                            return item.name;
                        } else {
                            return String(item);
                        }
                    });
                    
                    console.log('変換後のtaskStock:', this.taskStock);
                    
                    this.tempTaskStock = JSON.parse(JSON.stringify(this.taskStock)); // ディープコピー
                    console.log('タスクストック読み込み成功:', this.taskStock);
                }
            }
        } catch (error) {
            console.error('タスクストック読み込みエラー:', error);
        }
    }

    renderTaskStock() {
        const list = document.getElementById('task-stock-list');
        if (!list) {
            console.warn('タスクストックリスト要素が見つかりません');
            return;
        }
        
        list.innerHTML = '';
        
        // tempTaskStockが空配列でない場合のみ処理
        if (!this.tempTaskStock || this.tempTaskStock.length === 0) {
            list.innerHTML = '<div class="task-stock-empty"><span class="material-icons">inventory_2</span><p>タスクストックは空です</p><p class="sub-text">📚ボタンでタスクを追加してください</p></div>';
            this.updateTaskStockSaveButton();
            return;
        }
        
        this.tempTaskStock.forEach((taskItem, index) => {
            // データが文字列でない場合は文字列に変換
            const taskName = typeof taskItem === 'string' ? taskItem : (taskItem.name || String(taskItem));
            
            console.log(`renderTaskStock - index: ${index}, taskItem:`, taskItem, 'taskName:', taskName);
            
            const item = document.createElement('div');
            item.className = 'task-stock-item';
            item.draggable = true;
            item.setAttribute('data-index', index);
            item.innerHTML = `
                <div class="stock-item-content">
                    <div class="task-stock-item-drag-handle" title="ドラッグして並び替え">
                        <span class="material-icons">drag_indicator</span>
                    </div>
                    <div class="task-stock-item-name clickable" title="クリックして新しいタスクに追加" onclick="app.addTaskFromStock('${taskName.replace(/'/g, "\\'")}')">
                        <span class="material-icons" style="font-size: 14px; margin-right: 6px; opacity: 0.6; color: var(--accent);">add_circle_outline</span>
                        ${taskName}
                    </div>
                    <input type="text" value="${taskName}" class="task-stock-edit-input" oninput="app.onTaskInputChange(${index}, this)" style="display: none;">
                    <button class="task-stock-edit-btn" onclick="app.editTaskStockItem(${index})" title="編集">
                        <span class="material-icons">edit</span>
                    </button>
                    <button onclick="app.removeTempTask(${index})" title="削除">
                        <span class="material-icons">delete</span>
                    </button>
                </div>
            `;
            list.appendChild(item);
        });
        
        this.updateTaskStockSaveButton();
    }

    onTaskInputChange(index, inputElement) {
        const originalValue = inputElement.dataset.originalValue || this.tempTaskStock[index];
        const currentValue = inputElement.value.trim();
        
        if (currentValue !== originalValue) {
            this.tempTaskStock[index] = currentValue;
            this.hasTaskStockChanges = true;
            this.updateTaskStockSaveButton();
            
            // 表示名も更新
            const list = document.getElementById('task-stock-list');
            const item = list.querySelectorAll('.task-stock-item')[index];
            const nameDiv = item.querySelector('.task-stock-item-name');
            nameDiv.textContent = currentValue;
        }
    }

    editTaskStockItem(index) {
        const list = document.getElementById('task-stock-list');
        const item = list.querySelectorAll('.task-stock-item')[index];
        const nameDiv = item.querySelector('.task-stock-item-name');
        const input = item.querySelector('.task-stock-edit-input');
        const editBtn = item.querySelector('.task-stock-edit-btn');
        
        if (input.style.display === 'none') {
            // 編集モードに切り替え
            nameDiv.style.display = 'none';
            input.style.display = 'block';
            input.focus();
            input.select();
            editBtn.innerHTML = '<span class="material-icons">check</span>';
            editBtn.title = '入力終了';
            
            // 編集前の値を保存
            input.dataset.originalValue = this.tempTaskStock[index];  // 文字列として取得
        } else {
            // 入力終了：表示モードに戻る
            nameDiv.style.display = 'block';
            input.style.display = 'none';
            editBtn.innerHTML = '<span class="material-icons">edit</span>';
            editBtn.title = '編集';
        }
    }

    addTaskStock() {
        const input = document.getElementById('task-stock-input');
        const name = input.value.trim();
        if (name) {
            this.tempTaskStock.push(name);  // 文字列として追加
            input.value = '';
            this.hasTaskStockChanges = true;
            console.log('タスクストック追加後:', this.tempTaskStock);
            this.renderTaskStock();
        }
    }

    updateTempTask(index, newName) {
        this.tempTaskStock[index] = newName;  // 文字列として更新
        this.hasTaskStockChanges = true;
        this.updateTaskStockSaveButton();
    }

    removeTempTask(index) {
        this.tempTaskStock.splice(index, 1);
        this.hasTaskStockChanges = true;
        this.renderTaskStock();
    }

    updateTaskStockSaveButton() {
        const saveBtn = document.getElementById('save-task-stock-btn');
        saveBtn.disabled = !this.hasTaskStockChanges;
    }

    finishAllTaskEditing() {
        const list = document.getElementById('task-stock-list');
        const items = list.querySelectorAll('.task-stock-item');
        
        items.forEach(item => {
            const nameDiv = item.querySelector('.task-stock-item-name');
            const input = item.querySelector('.task-stock-edit-input');
            const editBtn = item.querySelector('.task-stock-edit-btn');
            
            if (input && input.style.display !== 'none') {
                // 編集モードを終了
                nameDiv.style.display = 'block';
                input.style.display = 'none';
                editBtn.innerHTML = '<span class="material-icons">edit</span>';
                editBtn.title = '編集';
            }
        });
    }

    async saveTaskStockChanges() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/task-stock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tasks: this.tempTaskStock }) });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.taskStock = this.tempTaskStock;
                    this.hasTaskStockChanges = false;
                    this.updateTaskStockSaveButton();
                    
                    // 編集モードを終了
                    this.finishAllTaskEditing();
                    
                    this.showToast('タスクストックを保存しました');
                }
            }
        } catch (error) {
            console.error('タスクストック保存エラー:', error);
            this.showToast('タスクストックの保存に失敗しました', 'error');
        }
    }

    // タスクストックからタスクを追加する機能
    addTaskFromStock(taskName) {
        console.log(`タスクストックからタスクを追加: "${taskName}"`);
        
        // メインのタスク入力欄にタスク名を設定
        const taskInput = document.getElementById('task-input');
        if (taskInput) {
            taskInput.value = taskName;
            
            // タスクストックダイアログを閉じる
            this.hideTaskStockDialog();
            
            // タスク入力欄にフォーカスを移す
            taskInput.focus();
            
            // カーソルを末尾に移動
            taskInput.setSelectionRange(taskInput.value.length, taskInput.value.length);
            
            this.showToast(`タスク「${taskName}」を入力欄に設定しました`);
        } else {
            console.error('タスク入力欄が見つかりません');
            this.showToast('タスクの追加に失敗しました', 'error');
        }
    }
    
    // 履歴機能
    switchToTodayMode() {
        console.log('今日モードに切り替え中...');
        this.currentMode = 'today';
        this.currentDate = null; // 今日の日付を示す
        
        // 日付検知を再初期化
        const now = new Date();
        this.lastKnownDate = now.toDateString();
        console.log('今日モード切り替え時の日付記録:', this.lastKnownDate);
        console.log('実際の今日の日付:', now.toString());
        
        // 履歴の日付入力フィールドをクリア（ユーザーの混乱を防ぐ）
        const calendarInput = document.getElementById('calendar-date-input');
        if (calendarInput) {
            calendarInput.value = '';
            console.log('今日モードに切り替え時に日付入力フィールドをクリアしました');
            this.syncCalendarInputHint();
        }
        
    // UI更新
        document.getElementById('today-btn').classList.add('active');
        document.getElementById('history-btn').classList.remove('active');
        document.getElementById('date-selector').style.display = 'none';
        // ヘッダー高さを一定に保つため、visibility で表示制御
        const currentTimeEl = document.getElementById('current-time');
        if (currentTimeEl) {
            currentTimeEl.style.visibility = 'visible';
        }
        document.getElementById('create-report-btn').style.display = 'flex';
        document.getElementById('goal-stock-btn').style.display = 'flex';
    // ヘッダーの履歴モード用クラスを解除
    const mainHeader = document.querySelector('.main-header');
    if (mainHeader) mainHeader.classList.remove('history-mode');
        
        // 今日のタスクを再読み込み
        console.log('今日モード切り替え - 今日のタスクを読み込み中...');
        this.loadTasks();
        
        // 日付表示を更新
        this.updateDateTime();
    }
    
    switchToHistoryMode() {
        console.log('履歴モードに切り替え中...');
        this.currentMode = 'history';
        
        // 履歴モードに切り替え時に日付入力フィールドをクリア（フレッシュスタート）
        const calendarInput = document.getElementById('calendar-date-input');
        if (calendarInput) {
            calendarInput.value = '';
            console.log('履歴モード切り替え時に日付入力フィールドをクリアしました');
            this.syncCalendarInputHint();
        }
        
    // UI更新
        document.getElementById('today-btn').classList.remove('active');
        document.getElementById('history-btn').classList.add('active');
        document.getElementById('date-selector').style.display = 'flex';
        // ヘッダー高さを一定に保つため、visibility で非表示（スペースは保持）
        const currentTimeEl2 = document.getElementById('current-time');
        if (currentTimeEl2) {
            currentTimeEl2.style.visibility = 'hidden';
        }
        document.getElementById('create-report-btn').style.display = 'none';
        document.getElementById('goal-stock-btn').style.display = 'none';
    // ヘッダーに履歴モード用クラスを付与
    const mainHeader2 = document.querySelector('.main-header');
    if (mainHeader2) mainHeader2.classList.add('history-mode');
        
        // 履歴日付を読み込み
        this.loadHistoryDates();
        
        // 内部状態をクリア
        this.currentDate = null;
        this.selectedDate = null;
        
        console.log('履歴モード切り替え時に選択された過去日付なし - 空の状態を表示');
        // 履歴が選択されていない状態のUI
        this.clearHistoryView();
    }
    
    clearHistoryView() {
        const container = document.getElementById('timeline-container');
        container.innerHTML = `
            <div class="timeline-empty">
                <span class="material-icons">history</span>
                <p>日付を選択してください</p>
                <p class="sub-text">カレンダーから閲覧したい日付を選びます</p>
            </div>
        `;
        
        // 統計情報もクリア
        document.getElementById('completed-tasks').textContent = '-';
        document.getElementById('work-time').textContent = '-';
        document.getElementById('productivity').textContent = '-';
        
        // 履歴日付表示をリセット
        document.getElementById('current-date').textContent = '日付を選択';
    }
    
    async loadHistoryDates() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/history/dates`);
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.historyDates = result.dates;
                    console.log('履歴日付を読み込みました:', this.historyDates);
                    
                    // カレンダーにマークを付けるなどの処理をここに追加できる
                }
            }
        } catch (error) {
            console.error('履歴日付の読み込みエラー:', error);
        }
    }
    
    onDateSelected(dateString) {
        console.log('onDateSelected - 選択された日付:', dateString);
        console.log('現在のモード:', this.currentMode);
        
        if (!dateString) {
            console.log('日付が空のため処理を中断');
            return;
        }
        
        // 履歴モードでない場合は処理をスキップ
        if (this.currentMode !== 'history') {
            console.log('履歴モードでないため、日付選択処理をスキップ');
            return;
        }
        
        // 今日の日付が選択された場合は今日モードに戻す
        const todayString = this.getTokyoTodayYmd();
        
        if (dateString === todayString) {
            console.log('履歴モードで今日が選択されました（iOSの自動選択を含む可能性あり）');
            this.showToast('今日のデータは「今日」モードでご確認ください', 'warning');

            // 履歴モードは維持したまま、未選択状態に戻す
            this.currentDate = null;
            this.selectedDate = null;

            const calendarInput = document.getElementById('calendar-date-input');
            if (calendarInput) {
                calendarInput.value = '';
            }

            this.syncCalendarInputHint();

            this.clearHistoryView();
            return;
        }
        
        // 選択された日付を内部状態に保存
        this.currentDate = dateString;
        this.selectedDate = dateString;
        
        console.log('履歴データの読み込みを開始します:', dateString);
        console.log('内部状態更新:', { currentDate: this.currentDate, selectedDate: this.selectedDate });
        
        // 履歴データを読み込み
        this.loadHistoryData(dateString);
        
        // 履歴日付表示を更新
        const date = new Date(dateString);
        const displayDate = date.toLocaleDateString('ja-JP', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long'
        });
        document.getElementById('current-date').textContent = displayDate;
        console.log('日付表示を更新しました:', displayDate);
    }
    
    async loadHistoryData(dateString) {
        try {
            console.log(`履歴データ読み込み開始: ${dateString}`);
            
            // ローディング状態を表示
            const container = document.getElementById('timeline-container');
            container.innerHTML = `
                <div class="timeline-empty">
                    <span class="material-icons">hourglass_empty</span>
                    <p>データを読み込み中...</p>
                </div>
            `;
            
            const response = await fetch(`${this.apiBaseUrl}/api/history/${dateString}`);
            if (response.ok) {
                const result = await response.json();
                console.log('履歴APIレスポンス:', result);
                
                if (result.success && result.data) {
                    console.log('履歴データ:', result.data);
                    
                    // タスクが存在する場合
                    if (result.data.tasks && result.data.tasks.length > 0) {
                        // 履歴データをタイムラインに表示
                        this.renderHistoryTimeline(result.data);
                        
                        // 統計情報を更新
                        this.updateHistoryStats(result.data.tasks);
                    } else {
                        // タスクが空の場合でも、日付情報があることを表示
                        this.renderEmptyHistory(dateString, '該当日にタスクが記録されていません');
                    }
                } else {
                    console.log('履歴データの取得に失敗:', result.message || '不明なエラー');
                    this.renderEmptyHistory(dateString, result.message || '履歴データを読み込めませんでした');
                }
            } else {
                // 404 は「その日のデータが無い」なので正常系として扱う
                if (response.status === 404) {
                    let message = '該当日にタスクが記録されていません';
                    try {
                        const result = await response.json();
                        if (result?.message) message = result.message;
                    } catch {
                        // ignore
                    }
                    this.renderEmptyHistory(dateString, message);
                    return;
                }

                // 401 は認証が必要
                if (response.status === 401) {
                    this.renderEmptyHistory(dateString, '未ログインです。右上からログインしてください');
                    return;
                }

                console.error('履歴APIリクエストが失敗しました:', response.status, response.statusText);
                this.renderEmptyHistory(dateString, `サーバーエラー (${response.status}): データを取得できませんでした`);
            }
        } catch (error) {
            console.error('履歴データ読み込みエラー:', error);
            this.renderEmptyHistory(dateString, `接続エラー: ${error.message}`);
        }
    }
    
    renderHistoryTimeline(historyData) {
        const container = document.getElementById('timeline-container');
        const tasks = historyData.tasks || [];
        
        console.log(`履歴タイムライン描画開始: 日付=${historyData.date}, タスク数=${tasks.length}`);
        
        if (tasks.length === 0) {
            this.renderEmptyHistory(historyData.date);
            return;
        }
        
        const timelineHTML = tasks.map(task => {
            const startTime = this.formatTime(task.startTime);
            const endTime = task.endTime ? this.formatTime(task.endTime) : '未完了';
            const duration = task.endTime ? this.calculateDuration(task.startTime, task.endTime) : '';

            const timeColumnHTML = task.endTime
                ? `<div class="timeline-time range"><span class="time-start">${startTime}</span><span class="time-line" aria-hidden="true"></span><span class="time-end">${this.formatTime(task.endTime)}</span></div>`
                : `<div class="timeline-time">${startTime}</div>`;
            
            // タスク名を表示用に整形
            let displayName = task.name || task.title || '名称未設定';
            
            // タグの表示
            const tagDisplay = task.tag ? `<span class="task-tag">${task.tag}</span>` : '';
            
            return `
                <div class="timeline-item">
                    ${timeColumnHTML}
                    <div class="timeline-content">
                        <div class="timeline-task" onclick="app.copyTaskToInput('${displayName.replace(/'/g, "\'")}', event)" oncontextmenu="app.copyTaskToInput('${displayName.replace(/'/g, "\'")}', event)" title="クリックでタスク名をコピー">${displayName}</div>
                        <div class="timeline-meta">
                            ${duration ? `<span class="timeline-duration">${duration}</span>` : ''}
                            ${tagDisplay}
                        </div>
                    </div>
                    <button class="timeline-edit" onclick="app.editHistoryTask('${historyData.date}', '${task.id}')" title="編集">
                        <span class="material-icons">edit</span>
                    </button>
                </div>
            `;
        }).join('');
        
        container.innerHTML = timelineHTML;
        console.log('履歴タイムライン描画完了');
    }
    
    renderEmptyHistory(dateString, customMessage = null) {
        const container = document.getElementById('timeline-container');
        
        if (dateString) {
            // 日付が指定されている場合は、その日にデータがないことを表示
            const date = new Date(dateString);
            const displayDate = date.toLocaleDateString('ja-JP', {
                month: 'long',
                day: 'numeric'
            });
            
            const message = customMessage || 'この日はタスクが記録されていません';
            
            container.innerHTML = `
                <div class="timeline-empty">
                    <span class="material-icons">calendar_today</span>
                    <p>${displayDate}のデータはありません</p>
                    <p class="sub-text">${message}</p>
                </div>
            `;
            
            console.log(`空の履歴表示: ${displayDate}, メッセージ: ${message}`);
        } else {
            // 日付が未選択の場合
            container.innerHTML = `
                <div class="timeline-empty">
                    <span class="material-icons">calendar_today</span>
                    <p>日付を選択してください</p>
                    <p class="sub-text">カレンダーから日付を選択して履歴を表示します</p>
                </div>
            `;
        }
        
        // 統計情報をクリア
        this.updateHistoryStats([]);
    }

    updateHistoryStats(tasks) {
        const completedWorkTasks = tasks.filter(task => task.endTime).length;
        
        const totalMinutes = tasks.reduce((total, task) => {
            if (task.endTime && task.startTime) {
                const duration = this.calculateDuration(task.startTime, task.endTime);
                if (!duration) return total;
                
                const hours = duration.match(/(\d+)時間/);
                const minutes = duration.match(/(\d+)分/);
                
                let taskMinutes = 0;
                if (hours) taskMinutes += parseInt(hours[1], 10) * 60;
                if (minutes) taskMinutes += parseInt(minutes[1], 10);
                
                return total + taskMinutes;
            }
            return total;
        }, 0);
        
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const totalWorkTime = `${hours}:${minutes.toString().padStart(2, '0')}`;

        const productivity = tasks.length > 0 ? `${Math.round(completedWorkTasks / tasks.length * 100)}%` : '-';
        
        document.getElementById('completed-tasks').textContent = completedWorkTasks;
        document.getElementById('work-time').textContent = totalWorkTime;
        document.getElementById('productivity').textContent = productivity;
    }
    
    handleWindowRestored() {
        // 1) タイムラインなど軽量な再描画のみ（ポップアップの再生成は行わない）
        if (this.currentMode === 'today') {
            // 直近の状態を反映（サーバに依存せず現在メモリのタスクを再描画）
            this.updateTimeline();
        } else if (this.currentMode === 'history' && this.currentDate) {
            // 履歴表示中は現状のUIを保つ
            this.updateTimeline();
        }

        // 2) ポップアップ（報告書/設定）が開いていてもそのまま保持。
        // 必要ならボタン状態などの軽量なUIのみ更新。
        const reportOpen = document.getElementById('report-dialog').classList.contains('show');
        if (reportOpen) {
            this.updateSaveButtonState();
            this.updateClipboardCopyButtonState();
        }
        const settingsOpen = document.getElementById('settings-dialog').classList.contains('show');
        if (settingsOpen) {
            // 丸めプレビュー等の軽微な更新のみ
            this.updateRoundingPreview?.();
        }

        // 3) タスク入力欄にフォーカス
        const taskInput = document.getElementById('task-input');
        if (taskInput) {
            taskInput.focus();
        }
        
        console.log('ウィンドウ復元後の再描画処理が完了しました');
    }

    // タグストック関連のメソッドをクラス内に移動
    showTagStockDialog() {
        console.log('=== タグストックダイアログ表示 ===');
        console.log('現在のtagStock:', JSON.stringify(this.tagStock, null, 2));
        
        const dialog = document.getElementById('tag-stock-dialog');
        dialog.classList.add('show');
        
        // 現在のタグストックからtempTagStockを作成（完全なコピー）
        this.tempTagStock = JSON.parse(JSON.stringify(this.tagStock));
        this.hasTagStockChanges = false;
        
        console.log('初期化後のtempTagStock:', JSON.stringify(this.tempTagStock, null, 2));
        console.log('変更フラグ初期状態:', this.hasTagStockChanges);
        
        this.renderTagStock();
        // ダイアログ表示後にドラッグ&ドロップを初期化
        setTimeout(() => this.initTagStockDragDrop(), 100);
        this.updateTagStockSaveButton();
    }

    hideTagStockDialog() {
        if (this.hasTagStockChanges) {
            const result = confirm('保存されていない変更があります。変更を破棄して閉じますか？');
            if (!result) {
                return; // キャンセルされた場合は閉じない
            }
        }
        
        const dialog = document.getElementById('tag-stock-dialog');
        dialog.classList.remove('show');
        this.hasTagStockChanges = false;
        
        // 編集中のアイテムを元に戻す
        this.tempTagStock = JSON.parse(JSON.stringify(this.tagStock));
        this.renderTagStock();
    }

    renderTagStock() {
        const container = document.getElementById('tag-stock-list');
        container.innerHTML = '';

        this.tempTagStock.forEach((tag, index) => {
            const tagItem = document.createElement('div');
            tagItem.className = 'stock-item';
            tagItem.draggable = true;
            tagItem.setAttribute('data-index', index);
            tagItem.innerHTML = `
                <div class="stock-item-content">
                    <div class="tag-stock-item-drag-handle" title="ドラッグして並び替え">
                        <span class="material-icons">drag_indicator</span>
                    </div>
                    <div class="tag-stock-item-name" title="タグ名">${tag.name}</div>
                    <input type="text" value="${tag.name}" class="tag-stock-edit-input" oninput="window.app.onTagInputChange(${index}, this)" style="display: none;">
                    <button class="tag-stock-edit-btn" onclick="window.app.editTagStockItem(${index})" title="編集">
                        <span class="material-icons">edit</span>
                    </button>
                    <button class="stock-item-remove" onclick="window.app.removeTempTag(${index})" title="削除">
                        <span class="material-icons">delete</span>
                    </button>
                </div>
            `;
            container.appendChild(tagItem);
        });

        this.updateTagStockSaveButton();
    }

    addTagStock() {
        const input = document.getElementById('tag-stock-input');
        const name = input.value.trim();
        if (name) {
            const isDuplicate = this.tempTagStock.some(tag => tag.name === name);
            if (isDuplicate) {
                this.showToast('同じ名前のタグが既に存在します', 'error');
                return;
            }
            
            this.tempTagStock.push({ 
                id: `tag-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                name 
            });
            input.value = '';
            this.hasTagStockChanges = true;
            this.renderTagStock();
        }
    }

    removeTempTag(index) {
        const removedTag = this.tempTagStock[index];
        
        // タグを使用しているタスクをカウント
        const taskCount = this.tasks.filter(task => task.tag === removedTag.name).length;
        
        // タグが使用されている場合は確認ダイアログを表示
        if (taskCount > 0) {
            const confirmMessage = `タグ「${removedTag.name}」は${taskCount}個のタスクで使用されています。\n削除すると、これらのタスクからタグが削除されます。\n本当に削除しますか？`;
            if (!confirm(confirmMessage)) {
                return; // キャンセルされた場合は処理を中断
            }
        }
        
        this.tempTagStock.splice(index, 1);
        this.hasTagStockChanges = true;
        
        // 現在のタスクからタグを削除
        this.tasks.forEach(task => {
            if (task.tag === removedTag.name) {
                task.tag = null;
            }
        });
        
        // 履歴データからもタグを削除（非同期で実行）
        this.updateHistoricalTaskTags(removedTag.name, null).catch(error => {
            console.warn('履歴データのタグ更新に失敗:', error);
        });
        
        this.updateTagDropdown();
        this.updateEditTagDropdown();
        
        if (this.currentMode === 'today') {
            this.updateTimeline();
        }
        
        this.updateStats();
        
        const reportDialog = document.getElementById('report-dialog');
        if (reportDialog && reportDialog.classList.contains('show')) {
            this.generateTagSummary();
        }
        
        this.renderTagStock();
        
        // タスクが更新された場合は通知
        if (taskCount > 0) {
            this.showToast(`タグ「${removedTag.name}」を削除し、${taskCount}個のタスクからタグを削除しました`, 'warning');
        }
    }

    editTagStockItem(index) {
        console.log(`=== タグ編集ボタンクリック - インデックス: ${index} ===`);
        
        const container = document.getElementById('tag-stock-list');
        const item = container.querySelectorAll('.stock-item')[index];
        
        if (!item) {
            console.error(`タグアイテムが見つかりません - インデックス: ${index}`);
            return;
        }
        
        const nameDiv = item.querySelector('.tag-stock-item-name');
        const input = item.querySelector('.tag-stock-edit-input');
        const editBtn = item.querySelector('.tag-stock-edit-btn');
        
        if (!nameDiv || !input || !editBtn) {
            console.error('必要なDOM要素が見つかりません');
            return;
        }
        
        if (input.style.display === 'none') {
            console.log(`編集モード開始 - インデックス: ${index}`);
            // 編集モードに切り替え
            nameDiv.style.display = 'none';
            input.style.display = 'block';
            input.focus();
            input.select();
            editBtn.innerHTML = '<span class="material-icons">check</span>';
            editBtn.title = '入力終了';
            
            // 編集前の値を保存
            input.dataset.originalValue = this.tempTagStock[index].name;
        } else {
            console.log(`編集モード終了 - インデックス: ${index}`);
            // 入力終了：表示モードに戻る
            const currentValue = input.value.trim();
            const originalValue = input.dataset.originalValue || this.tempTagStock[index].name;
            
            console.log(`値の確定: "${currentValue}" (元: "${originalValue}")`);
            
            // 空文字チェック
            if (currentValue === '') {
                input.value = originalValue;
                this.showToast('タグ名を空にすることはできません', 'warning');
            } else if (currentValue !== originalValue) {
                // 重複チェック
                const isDuplicate = this.tempTagStock.some((tag, idx) => 
                    idx !== index && tag.name === currentValue
                );
                
                if (isDuplicate) {
                    input.value = originalValue;
                    this.showToast('同じ名前のタグが既に存在します', 'error');
                } else {
                    // 値を確定
                    this.tempTagStock[index].name = currentValue;
                    this.hasTagStockChanges = true;
                    this.updateTagStockSaveButton();
                    console.log(`タグ名確定: インデックス ${index} -> "${currentValue}"`);
                }
            }
            
            // 表示モードに戻る
            nameDiv.textContent = this.tempTagStock[index].name; // 確定された値を表示
            nameDiv.style.display = 'block';
            input.style.display = 'none';
            editBtn.innerHTML = '<span class="material-icons">edit</span>';
            editBtn.title = '編集';
            
            // クリーンアップ
            delete input.dataset.originalValue;
            console.log(`編集完了 - 確定値: "${this.tempTagStock[index].name}"`);
        }
    }

    onTagInputChange(index, inputElement) {
        console.log(`=== onTagInputChange 呼び出し - インデックス: ${index} ===`);
        
        const originalValue = inputElement.dataset.originalValue || this.tempTagStock[index].name;
        const currentValue = inputElement.value.trim();
        
        console.log(`現在値: "${currentValue}"`);
        console.log(`元の値: "${originalValue}"`);
        
        // 目標ストックと同じ動作：入力のたびに即座に更新
        if (currentValue !== originalValue) {
            // 一時的な表示更新（tempTagStockの実際の値は編集完了時に更新）
            const container = document.getElementById('tag-stock-list');
            const item = container.querySelectorAll('.stock-item')[index];
            const nameDiv = item.querySelector('.tag-stock-item-name');
            nameDiv.textContent = currentValue;
            
            console.log(`タグ名表示更新: インデックス ${index} -> "${currentValue}" (元: "${originalValue}")`);
            console.log('表示のみ更新 - tempTagStockは編集完了時に更新');
        } else {
            console.log('入力変更なし');
        }
    }

    updateTagStockSaveButton() {
        const saveBtn = document.getElementById('save-tag-stock-btn');
        const wasDisabled = saveBtn.disabled;
        saveBtn.disabled = !this.hasTagStockChanges;
        
        if (wasDisabled !== saveBtn.disabled) {
            console.log(`保存ボタン状態変更: ${wasDisabled ? '無効' : '有効'} → ${saveBtn.disabled ? '無効' : '有効'} (変更フラグ: ${this.hasTagStockChanges})`);
        }
    }

    async loadTagStock() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/tags`);
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.tagStock = result.tags.map((tag, index) => ({
                        id: tag.id || `tag-${Date.now()}-${index}`,
                        name: tag.name
                    }));
                    this.tempTagStock = JSON.parse(JSON.stringify(this.tagStock));
                    this.renderTagStock();
                    this.updateTagDropdown();
                }
            }
        } catch (error) {
            console.error('タグストック読み込みエラー:', error);
        }
        this.updateTagStockSaveButton();
    }

    async checkAndFixTagIntegrity() {
        console.log('Checking tag integrity...');
        const currentTagNames = this.tagStock.map(tag => tag.name);
        let hasChanges = false;

        // 今日のタスクをチェック
        this.tasks.forEach(task => {
            if (task.tag && !currentTagNames.includes(task.tag)) {
                console.log(`Resetting invalid tag "${task.tag}" to null for today's task`);
                task.tag = null;
                hasChanges = true;
            }
        });

        // 履歴データをチェック（this.historyDataが存在する場合のみ）
        if (this.historyData && typeof this.historyData === 'object') {
            for (const [dateKey, historyTasks] of Object.entries(this.historyData)) {
                if (Array.isArray(historyTasks)) {
                    historyTasks.forEach(task => {
                        if (task.tag && !currentTagNames.includes(task.tag)) {
                            console.log(`Resetting invalid tag "${task.tag}" to null for task on ${dateKey}`);
                            task.tag = null;
                            hasChanges = true;
                        }
                    });
                }
            }
        } else {
            console.log('履歴データが初期化されていないため、履歴データのタグ整合性チェックをスキップしました');
        }

        // 変更があった場合は保存
        if (hasChanges) {
            console.log('Tag integrity issues found and fixed. Saving data...');
            await this.saveData();
        } else {
            console.log('Tag integrity check passed - no issues found.');
        }
    }

    updateTempTag(index, newName) {
        const oldName = this.tempTagStock[index].name;
        this.tempTagStock[index].name = newName;
        this.hasTagStockChanges = true;
        this.updateTagStockSaveButton();
        
        if (oldName !== newName) {
            this.previewTagNameChange(oldName, newName);
        }
    }

    previewTagNameChange(oldName, newName) {
        // プレビュー機能を無効化 - 実際の保存時のみタグ変更を適用
        console.log(`プレビューは無効化されています: "${oldName}" → "${newName}"`);
    }

    finishAllTagEditing() {
        console.log('全タグ編集モード終了処理開始');
        const container = document.getElementById('tag-stock-list');
        const items = container.querySelectorAll('.stock-item');
        
        items.forEach((item, index) => {
            const nameDiv = item.querySelector('.tag-stock-item-name');
            const input = item.querySelector('.tag-stock-edit-input');
            const editBtn = item.querySelector('.tag-stock-edit-btn');
            
            if (input && nameDiv && editBtn) {
                // 入力が編集モードの場合のみ処理
                if (input.style.display !== 'none') {
                    console.log(`タグ${index}の編集モードを終了`);
                    
                    // 現在の入力値でtempTagStockを更新（最終確定）
                    const currentValue = input.value.trim();
                    if (currentValue && this.tempTagStock[index]) {
                        this.tempTagStock[index].name = currentValue;
                        nameDiv.textContent = currentValue;
                    }
                    
                    // 編集モードを終了
                    nameDiv.style.display = 'block';
                    input.style.display = 'none';
                    editBtn.innerHTML = '<span class="material-icons">edit</span>';
                    editBtn.title = '編集';
                    
                    // originalValue属性をクリア
                    delete input.dataset.originalValue;
                }
            }
        });
        console.log('全タグ編集モード終了処理完了');
    }

    async saveTagStockChanges() {
        console.log('=== シンプルなタグ保存処理開始 ===');
        console.log('保存対象のタグ:', this.tempTagStock);
        
        if (!this.hasTagStockChanges) {
            console.log('変更がないため保存処理をスキップ');
            this.showToast('変更がありません', 'warning');
            return;
        }
        
        try {
            console.log('APIリクエスト送信 - URL:', `${this.apiBaseUrl}/api/tags`);
            console.log('リクエストボディ:', JSON.stringify({ tags: this.tempTagStock }));
            
            const response = await fetch(`${this.apiBaseUrl}/api/tags`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ tags: this.tempTagStock }) 
            });
            
            console.log('レスポンス - ステータス:', response.status);
            console.log('レスポンス - OK:', response.ok);
            
            if (response.ok) {
                const result = await response.json();
                console.log('レスポンス内容:', result);
                
                // 保存成功の処理
                console.log('保存成功 - データ更新中');
                this.tagStock = [...this.tempTagStock];
                this.hasTagStockChanges = false;
                this.updateTagStockSaveButton();
                this.finishAllTagEditing();
                
                console.log('UI更新中');
                this.renderTagStock();
                this.updateTagDropdown();
                this.updateEditTagDropdown();
                
                console.log('=== タグ保存処理完了 ===');
                this.showToast('タグを保存しました');
            } else {
                console.error('保存失敗 - HTTPステータス:', response.status);
                const errorText = await response.text();
                console.error('エラー内容:', errorText);
                this.showToast('保存に失敗しました', 'error');
            }
        } catch (error) {
            console.error('保存エラー:', error);
            this.showToast('保存中にエラーが発生しました', 'error');
        }
    }

    updateExistingTaskTags(oldTags, newTags) {
        const tagNameChanges = {};
        const deletedTags = [];
        const newTagNames = new Set(newTags.map(tag => tag.name));
        
        oldTags.forEach(oldTag => {
            const matchingNewTag = newTags.find(newTag => 
                newTag.id === oldTag.id || 
                (newTag.originalId && newTag.originalId === oldTag.id)
            );
            
            if (matchingNewTag) {
                if (oldTag.name !== matchingNewTag.name) {
                    tagNameChanges[oldTag.name] = matchingNewTag.name;
                }
            } else if (!newTagNames.has(oldTag.name)) {
                deletedTags.push(oldTag.name);
            }
        });

        this.tasks.forEach(task => {
            if (task.tag) {
                if (tagNameChanges[task.tag]) {
                    task.tag = tagNameChanges[task.tag];
                } else if (deletedTags.includes(task.tag)) {
                    task.tag = null;
                }
            }
        });

        this.updateHistoricalTaskTags(tagNameChanges, deletedTags);
    }

    async updateHistoricalTaskTags(tagNameChanges, deletedTags = []) {
        try {
            const datesResponse = await fetch(`${this.apiBaseUrl}/api/history/dates`);
            if (!datesResponse.ok) return;

            const datesResult = await datesResponse.json();
            if (!datesResult.success || !datesResult.dates) return;

            for (const dateString of datesResult.dates) {
                try {
                    const historyResponse = await fetch(`${this.apiBaseUrl}/api/history/${dateString}`);
                    if (!historyResponse.ok) continue;

                    const historyResult = await historyResponse.json();
                    if (!historyResult.success || !historyResult.data || !historyResult.data.tasks) continue;

                    let hasChanges = false;
                    historyResult.data.tasks.forEach(task => {
                        if (task.tag) {
                            if (tagNameChanges[task.tag]) {
                                task.tag = tagNameChanges[task.tag];
                                hasChanges = true;
                            } else if (deletedTags.includes(task.tag)) {
                                task.tag = null;
                                hasChanges = true;
                            }
                        }
                    });

                    if (hasChanges) {
                        await fetch(`${this.apiBaseUrl}/api/history/${dateString}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(historyResult.data)
                        });
                    }
                } catch (error) {
                    console.error(`履歴データ更新エラー (${dateString}):`, error);
                }
            }
        } catch (error) {
            console.error('履歴データのタグ名更新エラー:', error);
        }
    }

    // タグドロップダウンの更新
    updateTagDropdown() {
        const tagSelect = document.getElementById('task-tag-select');
        if (!tagSelect) return;

        // 現在選択されている値を保持
        const currentValue = tagSelect.value;

    tagSelect.innerHTML = '<option value="">タグを選択</option>';
        
        // タグストックから選択肢を追加
        this.tagStock.forEach(tag => {
            const option = document.createElement('option');
            option.value = tag.name;
            option.textContent = tag.name;
            tagSelect.appendChild(option);
        });
        
        // 現在の値がタグストックに存在しない場合は、一時的な選択肢として追加
        if (currentValue && !this.tagStock.some(tag => tag.name === currentValue)) {
            const option = document.createElement('option');
            option.value = currentValue;
            option.textContent = `${currentValue} (削除済み)`;
            option.style.color = '#888'; // グレーアウトして表示
            tagSelect.appendChild(option);
        }
        
        // 保持していた値を再設定
        if (currentValue) {
            tagSelect.value = currentValue;
        }
    }

    // 編集ダイアログのタグドロップダウン更新
    updateEditTagDropdown() {
        const tagSelect = document.getElementById('edit-task-tag');
        if (!tagSelect) return;

        // 現在選択されている値を保持
        const currentValue = tagSelect.value;

    tagSelect.innerHTML = '<option value="">タグを選択</option>';
        
        // タグストックから選択肢を追加
        this.tagStock.forEach(tag => {
            const option = document.createElement('option');
            option.value = tag.name;
            option.textContent = tag.name;
            tagSelect.appendChild(option);
        });
        
        // 現在の値がタグストックに存在しない場合は、一時的な選択肢として追加
        if (currentValue && !this.tagStock.some(tag => tag.name === currentValue)) {
            const option = document.createElement('option');
            option.value = currentValue;
            option.textContent = `${currentValue} (削除済み)`;
            option.style.color = '#888'; // グレーアウトして表示
            tagSelect.appendChild(option);
        }
        
        // 保持していた値を再設定
        if (currentValue) {
            tagSelect.value = currentValue;
        }
    }

    // タグストックの変更をチェック
    checkTagStockChanges() {
        // オリジナルとtempを比較して変更があるかチェック
        const hasChanges = JSON.stringify(this.tagStock) !== JSON.stringify(this.tempTagStock);
        this.hasTagStockChanges = hasChanges;
        this.updateTagStockSaveButton();
    }

    async addTaskNameToStock() {
        const taskNameInput = document.getElementById('edit-task-name');
        const taskName = taskNameInput.value.trim();
        
        if (!taskName) {
            this.showToast('タスク名を入力してください', 'warning');
            return;
        }
        
        // 休憩タスクはストックに追加しない
        if (taskName === '休憩' || taskName.includes('休憩')) {
            this.showToast('休憩タスクはストックに追加できません', 'warning');
            return;
        }
        
        // 既に存在するかチェック
        if (this.taskStock.includes(taskName)) {
            this.showToast('そのタスクは既にストックに存在します', 'warning');
            return;
        }
        
        try {
            // タスクストックに追加
            this.taskStock.push(taskName);
            // tempTaskStockも更新（存在しない場合は初期化）
            if (!this.tempTaskStock) {
                this.tempTaskStock = [...this.taskStock];
            } else {
                this.tempTaskStock.push(taskName);
            }
            
            // 変更フラグを設定
            this.hasTaskStockChanges = true;
            
            // すぐにサーバーに保存
            await this.saveTaskStockChanges();
            
            // タスクストックダイアログが開いている場合はUIを更新
            const dialog = document.getElementById('task-stock-dialog');
            if (dialog && dialog.classList.contains('show')) {
                this.renderTaskStock();
            }
            
            this.showToast(`「${taskName}」をタスクストックに追加しました`, 'success');
            
        } catch (error) {
            console.error('タスクストック追加エラー:', error);
            this.showToast('タスクストックへの追加に失敗しました', 'error');
        }
    }
}

const app = new NippoApp();
window.app = app; // グローバルスコープにappを公開

// グローバルなエラーハンドリング
window.addEventListener('error', (event) => {
    console.error('レンダラープロセスで未捕捉のエラー:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('レンダラープロセスで未処理のPromise rejection:', event.reason);
});
