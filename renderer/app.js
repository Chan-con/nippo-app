class NippoApp {
    constructor() {
        this.tasks = [];
        this.currentTaskId = null;
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
        this.currentHotkeyTarget = null;
        this.isCapturingHotkey = false;
        this.settings = {};
        this.currentMode = 'today';
        this.selectedDate = null;
        this.currentDate = null; // 統一された日付管理（null = 今日）
        this.historyDates = [];
        this.lastKnownDate = null; // 日付変更検知用
        this.init();
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
        this.setupEventListeners();
        this.updateDateTime();
        this.updateTaskCounter();
        this.updateBreakButton(false); // 初期状態は休憩開始ボタン

        // 初期日付を記録
        const now = new Date();
        this.lastKnownDate = now.toDateString();
        console.log('アプリ初期化時の日付記録:', this.lastKnownDate);

        // タスク入力フォーカスのイベントリスナーを追加（重複防止）
        if (!this.eventListenersInitialized) {
            window.electronAPI.onFocusTaskInput(() => {
                const taskInput = document.getElementById('task-input');
                if (taskInput) {
                    taskInput.focus();
                }
            });
            
            // ウィンドウ復元時の処理を追加
            window.electronAPI.onWindowRestored(() => {
                console.log('ウィンドウが復元されました - DOM状態を確認中...');
                this.handleWindowRestored();
            });
            
            
            
            this.eventListenersInitialized = true;
        }

        // APIサーバーのポートを取得し、準備を待つ
        window.electronAPI.onApiPort(async (port) => {
            console.log(`APIポートを受信: ${port}`);
            this.apiPort = port;
            this.apiBaseUrl = `http://localhost:${port}`;

            console.log('APIサーバーの準備を待機中...');
            const isApiReady = await this.waitForAPI();

            if (isApiReady) {
                // 起動時に既存データを読み込み
                console.log('アプリ起動時のデータ読み込み開始...');
                await this.loadTasks();
                
                // 履歴データを読み込み
                await this.loadHistoryDates();
                
                // 目標ストックを読み込み
                await this.loadGoalStock();
                
                // タスクストックを読み込み
                await this.loadTaskStock();
                
                // タグストックを読み込み
                await this.loadTagStock();
                
                // タグの整合性をチェックして自動修正
                await this.checkAndFixTagIntegrity();
                
                // タグドロップダウンを初期化
                this.updateTagDropdown();
                
                // 設定を読み込み
                try {
                    await this.loadSettings();
                } catch (error) {
                    console.error('設定の読み込みに失敗しました:', error);
                }
            } else {
                console.error('APIの準備が完了しなかったため、タスクを読み込めません。');
                // ここでユーザーにエラーメッセージを表示するなどの処理を追加できます
            }
        });

        // 1分ごとに時刻を更新
        setInterval(() => this.updateDateTime(), 60000);
        
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
                const today = new Date().toISOString().split('T')[0];
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
            const todayISOString = today.toISOString().split('T')[0];
            
            const originalCount = this.tasks.length;
            this.tasks = this.tasks.filter(task => {
                if (task.createdAt) {
                    const taskDate = new Date(task.createdAt).toDateString();
                    return taskDate === todayString;
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
        // タスク追加
        const addBtn = document.getElementById('add-task-btn');
        const taskInput = document.getElementById('task-input');
        
        addBtn.addEventListener('click', () => this.addTask());
        taskInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addTask();
        });

        // タスク終了
        document.getElementById('end-task-btn').addEventListener('click', () => this.endTask());

        // 休憩開始/終了
        document.getElementById('break-btn').addEventListener('click', () => this.toggleBreak());

        // タイムラインコピー
        document.getElementById('copy-timeline-btn').addEventListener('click', () => this.copyTimeline());

        // すべてクリア（設定画面で初期化される）

        // 履歴機能
        document.getElementById('today-btn').addEventListener('click', () => this.switchToTodayMode());
        document.getElementById('history-btn').addEventListener('click', () => this.switchToHistoryMode());
        
        // 日付入力イベントリスナーを遅延追加（DOM確実に存在する状態で）
        setTimeout(() => {
            const calendarInput = document.getElementById('calendar-date-input');
            if (calendarInput) {
                // 未来の日付を選択できないように制限
                const today = new Date();
                calendarInput.max = today.toISOString().split('T')[0];
                
                calendarInput.addEventListener('change', (e) => {
                    console.log('日付変更イベントが発生しました:', e.target.value);
                    this.onDateSelected(e.target.value);
                });
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

        // タイトルバーボタン
        document.querySelector('.titlebar-button.minimize').addEventListener('click', () => {
            window.close(); // 最小化はcloseイベントで処理されタスクトレイに格納される
        });

        document.querySelector('.titlebar-button.close').addEventListener('click', () => {
            window.close();
        });

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
        
        // ホットキー入力フィールドのイベントリスナー
        document.getElementById('hotkey-toggle').addEventListener('click', () => this.startHotkeyCapture('hotkey-toggle'));
        
        // クリアボタンのイベントリスナー
        document.querySelectorAll('.clear-hotkey').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.target.closest('.clear-hotkey').dataset.target;
                this.clearHotkey(target);
            });
        });
        

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
        
        // ホットキーキャプチャ用のキーボードイベントリスナー
        document.addEventListener('keydown', (e) => {
            if (this.isCapturingHotkey) {
                this.captureHotkey(e);
            }
        });
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
        }
    }

    getTime() {
        const now = new Date();
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
                this.updateBreakButton(false);
                
                // UIを即座に更新（空の状態で表示）
                this.updateTimeline();
                this.updateStats();
                this.updateTaskCounter();
                
                console.log('新しい日のタスクデータを読み込み中...');
                // 新しい日のタスクデータを読み込み
                await this.loadTasks();
                
                // 履歴日付リストを更新
                await this.loadHistoryDates();
                
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
        const todayISOString = today.toISOString().split('T')[0]; // "2025-07-23" 形式
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
                const taskDate = new Date(task.createdAt).toDateString();
                console.log(`- createdAt: ${task.createdAt} (${taskDate})`);
                if (taskDate !== todayString) {
                    console.log(`- 古いタスクを検知: ${taskDate} != ${todayString}`);
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
                    const taskDate = new Date(task.createdAt).toDateString();
                    return taskDate === todayString;
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
        const currentRunningTask = this.tasks.find(task => !task.endTime);
        
        try {
            // 統一されたAPI呼び出し（日付パラメータ付き）
            const requestData = { 
                name: taskName, 
                isBreak: false,
                tag: selectedTag || null,
                dateString: this.currentDate // null = 今日、文字列 = 指定日
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


    async toggleBreak() {
        // 現在実行中のタスクがあるかチェック
        const currentRunningTask = this.tasks.find(task => !task.endTime);
        
        if (currentRunningTask && currentRunningTask.isBreak) {
            // 休憩中の場合は休憩を終了
            await this.endBreak();
        } else {
            // 休憩中でない場合は休憩を開始
            await this.startBreak();
        }
    }

    async startBreak() {
        // 現在実行中のタスクがあるかチェック
        const currentRunningTask = this.tasks.find(task => !task.endTime);
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '休憩', isBreak: true }) });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    await this.loadTasks();
                    
                    // 前のタスクが自動終了された場合の通知
                    if (currentRunningTask) {
                        this.showToast(`「${currentRunningTask.name}」を終了し、休憩を開始しました`);
                    } else {
                        this.showToast('休憩を開始しました');
                    }
                }
            }
        } catch (error) {
            console.error('休憩開始エラー:', error);
            this.showToast('休憩の開始に失敗しました', 'error');
        }
    }

    async endBreak() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/tasks/end`, { method: 'POST' });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    await this.loadTasks();
                    this.showToast('休憩を終了しました');
                }
            }
        } catch (error) {
            console.error('休憩終了エラー:', error);
            this.showToast('休憩の終了に失敗しました', 'error');
        }
    }

    async endTask() {
        // 過去日付では今日のタスク操作を無効化
        if (this.currentDate) {
            this.showToast('過去日付ではタスクを終了できません', 'warning');
            return;
        }
        
        // 実行中のタスクがあるかチェック
        const runningTask = this.tasks.find(task => !task.endTime);
        
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
                    const endTime = task.endTime ? task.endTime : '実行中';
                    
                    // 休憩タスクの表示名を整理
                    let displayName = task.name;
                    if (task.isBreak) {
                        if (displayName === '[BREAK] 休憩' || displayName === '🔴 休憩' || displayName === '') {
                            displayName = '休憩';
                        } else if (displayName.startsWith('[BREAK] ')) {
                            displayName = displayName.replace('[BREAK] ', '');
                        } else if (displayName.startsWith('🔴 休憩: ')) {
                            displayName = displayName.replace('🔴 休憩: ', '');
                        }
                    }
                    
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
                    const todayISOString = today.toISOString().split('T')[0]; // "2025-07-23" 形式
                    
                    console.log('今日の日付フィルタ:', todayString, '(ISO:', todayISOString, ')');
                    
                    // タスクを今日のもののみにフィルタリング
                    const todayTasks = allTasks.filter(task => {
                        // createdAtによる判定
                        if (task.createdAt) {
                            const taskDate = new Date(task.createdAt).toDateString();
                            const isToday = taskDate === todayString;
                            console.log(`タスク "${task.name}": createdAt=${task.createdAt}, taskDate=${taskDate}, isToday=${isToday}`);
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

                    // 現在実行中のタスクを更新
                    const runningTask = this.tasks.find(task => !task.endTime);
                    if (runningTask) {
                        console.log('実行中のタスク:', runningTask);
                        this.currentTaskId = runningTask.id;
                        if (runningTask.isBreak) {
                            this.updateCurrentTask('🔴 休憩中');
                            this.updateBreakButton(true); // 休憩中の場合は終了ボタンに変更
                        } else {
                            this.updateCurrentTask(runningTask.name);
                            this.updateBreakButton(false); // 通常タスクの場合は開始ボタンに変更
                        }
                    } else {
                        console.log('実行中のタスクはありません');
                        this.currentTaskId = null;
                        this.updateCurrentTask('タスクなし');
                        this.updateBreakButton(false); // タスクなしの場合は開始ボタン
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

        const timelineHTML = this.tasks.map(task => {
            const startTime = this.formatTime(task.startTime);
            const endTime = task.endTime ? this.formatTime(task.endTime) : '実行中';
            const duration = task.endTime ? this.calculateDuration(task.startTime, task.endTime) : '';
            const isRunning = !task.endTime;
            const isBreak = task.isBreak || false;
            
            // デバッグ情報
            if (task.endTime) {
                console.log('タスク詳細:', {
                    name: task.name,
                    startTime: task.startTime,
                    endTime: task.endTime,
                    duration: duration,
                    isBreak: isBreak
                });
            }
            
            // クラスを動的に設定
            let itemClass = 'timeline-item';
            if (isRunning && isBreak) {
                // 実行中の休憩のみ特別なスタイル
                itemClass += ' running break';
            } else if (isRunning) {
                // 実行中の通常タスク
                itemClass += ' running';
            }
            // 終了した休憩タスクは通常のタスクと同じ表示にする
            
            // タスク名を表示用に整形（休憩の場合は適切に表示）
            let displayName = task.name;
            if (isBreak) {
                if (displayName === '[BREAK] 休憩' || displayName === '🔴 休憩' || displayName === '') {
                    displayName = '休憩';
                } else if (displayName.startsWith('[BREAK] ')) {
                    displayName = displayName.replace('[BREAK] ', '');
                } else if (displayName.startsWith('🔴 休憩: ')) {
                    displayName = displayName.replace('🔴 休憩: ', '');
                } else if (displayName.startsWith('🔴 休憩')) {
                    displayName = displayName.replace('🔴 休憩', '').trim();
                    if (!displayName) displayName = '休憩';
                }
            }
            
            // タグの表示
            const tagDisplay = task.tag ? `<span class="task-tag">${task.tag}</span>` : '';
            
            return `
                <div class="${itemClass}">
                    <div class="timeline-time">${startTime}</div>
                    <div class="timeline-content">
                        <div class="timeline-task" onclick="app.copyTaskToInput('${displayName.replace(/'/g, "\'")}', event)" oncontextmenu="app.copyTaskToInput('${displayName.replace(/'/g, "\'")}', event)" title="クリックでタスク名をコピー">
                            ${displayName}
                        </div>
                        <div class="timeline-meta">
                            ${duration ? `<span class="timeline-duration">${duration}</span>` : ''}
                            ${tagDisplay}
                            ${isRunning ? `<span class="timeline-duration" style="background: ${isBreak ? 'var(--warning)' : 'var(--accent)'}; color: ${isBreak ? 'var(--bg-primary)' : 'white'};">${isBreak ? '休憩中' : '実行中'}</span>` : ''}
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
        // 休憩以外の完了したタスクのみをカウント
        const completedWorkTasks = this.tasks.filter(task => task.endTime && !task.isBreak).length;
        const totalWorkTime = this.calculateTotalWorkTime();
        const productivity = this.calculateProductivity();

        document.getElementById('completed-tasks').textContent = completedWorkTasks;
        document.getElementById('work-time').textContent = totalWorkTime;
        document.getElementById('productivity').textContent = productivity;
    }

    updateTaskCounter() {
        const activeTasks = this.tasks.filter(task => !task.endTime).length;
        document.getElementById('task-count').textContent = activeTasks;
        
        // 実行中のタスクがない場合はタスク終了ボタンを非表示
        this.updateEndTaskButtonVisibility();
    }

    updateEndTaskButtonVisibility() {
        const endTaskBtn = document.getElementById('end-task-btn');
        const runningTasks = this.tasks.filter(task => !task.endTime);
        const isOnBreak = runningTasks.some(task => task.isBreak);
        
        // 実行中のタスクがない、または休憩中の場合は非表示
        if (runningTasks.length === 0 || isOnBreak) {
            endTaskBtn.style.display = 'none';
        } else {
            endTaskBtn.style.display = 'flex';
        }
    }

    updateCurrentTask(taskName) {
        document.getElementById('current-task').textContent = taskName;
    }

    updateBreakButton(isOnBreak) {
        const breakBtn = document.getElementById('break-btn');
        const icon = breakBtn.querySelector('.material-icons');
        const text = breakBtn.querySelector('span:not(.material-icons)') || breakBtn.childNodes[breakBtn.childNodes.length - 1];
        
        if (isOnBreak) {
            // 休憩終了ボタンに変更
            icon.textContent = 'stop_circle';
            if (text.nodeType === Node.TEXT_NODE) {
                text.textContent = '休憩終了';
            } else {
                breakBtn.innerHTML = '<span class="material-icons">stop_circle</span>休憩終了';
            }
            breakBtn.classList.remove('btn-break');
            breakBtn.classList.add('btn-secondary');
        } else {
            // 休憩開始ボタンに変更
            icon.textContent = 'coffee';
            if (text.nodeType === Node.TEXT_NODE) {
                text.textContent = '休憩開始';
            }
            else {
                breakBtn.innerHTML = '<span class="material-icons">coffee</span>休憩開始';
            }
            breakBtn.classList.remove('btn-secondary');
            breakBtn.classList.add('btn-break');
        }
        
        // タスク終了ボタンの表示状態を更新
        this.updateEndTaskButtonVisibility();
    }

    formatTime(timeString) {
        // "午前 10:30" -> "10:30"
        if (!timeString) return '';
        return timeString.replace('午前 ', '').replace('午後 ', '');
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
        // 休憩時間を除外して作業時間のみを計算
        const totalMinutes = this.tasks.reduce((total, task) => {
            if (task.endTime && task.startTime && !task.isBreak) {
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
        // 休憩以外のタスクのみで生産性を計算
        const workTasks = this.tasks.filter(task => !task.isBreak);
        if (workTasks.length === 0) return '-';
        const completedRatio = workTasks.filter(task => task.endTime).length / workTasks.length;
        return `${Math.round(completedRatio * 100)}%`;
    }

    copyTaskToInput(taskName, event) {
        // 右クリックの場合のみコンテキストメニューを無効化
        if (event.type === 'contextmenu') {
            event.preventDefault();
        }
        
        // 休憩タスクの場合はコピーしない
        if (taskName === '休憩' || taskName.includes('休憩')) {
            this.showToast('休憩タスクはコピーできません', 'warning');
            return;
        }
        
        const taskInput = document.getElementById('task-input');
        // 既存の入力内容をクリアしてから新しいタスク名をセット
        taskInput.value = '';
        taskInput.value = taskName;
        taskInput.focus();
        taskInput.select(); // テキストを選択状態にする
        
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

    deleteCurrentTask() {
        // タスクIDの比較を柔軟に行う
        const task = this.tasks.find(t => {
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
        
        if (!task) {
            console.error('削除対象のタスクが見つかりません:', {
                editingTaskId: this.editingTaskId,
                editingTaskIdType: typeof this.editingTaskId,
                availableTasks: this.tasks.map(t => ({ id: t.id, type: typeof t.id, name: t.name }))
            });
            return;
        }

        const dialog = document.getElementById('confirm-dialog');
        const title = document.getElementById('confirm-title');
        const message = document.getElementById('confirm-message');
        
        title.textContent = 'タスクを削除';
        const taskName = task.name || task.title || 'タスク';
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
            console.log('履歴タスク削除開始:', { taskId, dateString });
            
            if (taskId === null || taskId === undefined || !dateString) {
                this.showToast('削除対象のタスクまたは日付が特定できません', 'error');
                return;
            }
            
            const response = await fetch(`${this.apiBaseUrl}/api/history/${dateString}/tasks/${taskId}`, { method: 'DELETE' });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    // 履歴データを再読み込み
                    await this.loadHistoryData(dateString);
                    
                    // 報告書ダイアログが開いている場合はタグサマリーも更新
                    const reportDialog = document.getElementById('report-dialog');
                    if (reportDialog && reportDialog.classList.contains('show')) {
                        await this.generateTagSummary();
                    }
                    
                    this.showToast('履歴タスクを削除しました');
                } else {
                    this.showToast('履歴タスクの削除に失敗しました', 'error');
                }
            }
        } catch (error) {
            console.error('履歴タスク削除エラー:', error);
            this.showToast('履歴タスクの削除に失敗しました', 'error');
        } finally {
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
            const hasRunningTasks = this.tasks.some(task => !task.endTime);
            
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
        const runningTasks = this.tasks.filter(task => !task.endTime);

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

    async generateTagSummary() {
        const summaryContainer = document.getElementById('tag-summary');
        
        if (this.tasks.length === 0) {
            summaryContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">今日はまだタスクがありません</p>';
            return;
        }

        // タグ別作業時間とタスクを計算
        const tagData = new Map();
        
        // 完了したタスクのみを対象とする
        const completedTasks = this.tasks.filter(task => task.endTime && !task.isBreak);
        
        completedTasks.forEach(task => {
            if (task.tag) {
                const duration = this.calculateDurationInMinutes(task.startTime, task.endTime);
                if (!tagData.has(task.tag)) {
                    tagData.set(task.tag, {
                        totalMinutes: 0,
                        tasks: []
                    });
                }
                const data = tagData.get(task.tag);
                data.totalMinutes += duration;
                data.tasks.push({
                    name: task.name,
                    startTime: task.startTime,
                    endTime: task.endTime,
                    duration: this.calculateDuration(task.startTime, task.endTime)
                });
            }
        });

        // タグ別作業時間が空の場合
        if (tagData.size === 0) {
            summaryContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">タグが設定されたタスクがありません</p>';
            return;
        }

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

        // タブナビゲーション生成
        let tabsHTML = '<div class="tag-tabs-navigation">';
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
                <div class="tag-tab-panel${isActive}" id="${panelId}">
                    <div class="tag-tasks">`;
            
            // タスク一覧
            tagInfo.tasks.forEach(task => {
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
                        <span>合計: ${durationText}</span>
                        <button class="tag-copy-btn" onclick="app.copyTagSummary('${tagName}', '${durationText}')" title="タグ名と時間をコピー">
                            <span class="material-icons">content_copy</span>
                            コピー
                        </button>
                    </div>
                </div>
            `;
        });
        
        tabsHTML += '</div>';
        panelsHTML += '</div>';
        
        summaryContainer.innerHTML = tabsHTML + panelsHTML;
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
        }
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
    }

    closeSettingsDialog() {
        const dialog = document.getElementById('settings-dialog');
        dialog.classList.remove('show');
        
        // ホットキーキャプチャを停止
        this.isCapturingHotkey = false;
        this.currentHotkeyTarget = null;
    }
    
    async loadSettings() {
        try {
            const settings = await window.electronAPI.getSettings();
            this.settings = settings;
            
            // UI要素に設定を反映
            const hotkeyToggle = document.getElementById('hotkey-toggle');
            
            if (hotkeyToggle) {
                hotkeyToggle.value = settings.globalHotkey?.toggleWindow || '';
            }
            
        } catch (error) {
            console.error('設定の読み込みエラー:', error);
            this.showToast('設定の読み込みに失敗しました', 'error');
        }
    }
    
    async saveSettings() {
        try {
            const hotkeyToggle = document.getElementById('hotkey-toggle').value;
            
            const settings = {
                ...this.settings,
                globalHotkey: {
                    toggleWindow: hotkeyToggle
                }
            };
            
            const result = await window.electronAPI.saveSettings(settings);
            if (result) {
                this.settings = settings;
                this.showToast('設定を保存しました');
            } else {
                this.showToast('設定の保存に失敗しました', 'error');
            }
        } catch (error) {
            console.error('設定の保存エラー:', error);
            this.showToast('設定の保存に失敗しました', 'error');
        }
    }
    
    startHotkeyCapture(targetId) {
        this.currentHotkeyTarget = targetId;
        this.isCapturingHotkey = true;
        
        const input = document.getElementById(targetId);
        if (input) {
            input.value = '';
            input.placeholder = 'キーの組み合わせを押してください...';
            input.focus();
        }
    }
    
    captureHotkey(event) {
        if (!this.isCapturingHotkey || !this.currentHotkeyTarget) return;
        
        event.preventDefault();
        const modifiers = [];
        if (event.ctrlKey) modifiers.push('Control');
        if (event.altKey) modifiers.push('Alt');
        if (event.shiftKey) modifiers.push('Shift');
        if (event.metaKey) modifiers.push('Super'); // Windowsキー or Commandキー

        let key = event.key;
        
        // 修飾キーのみの場合は何もしない
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
            return;
        }
        
        // キー名をElectronのAccelerator形式に変換
        if (key.length === 1) {
            key = key.toUpperCase();
        } else if (key.startsWith('Arrow')) {
            key = key.replace('Arrow', '');
        } else if (key === ' ') {
            key = 'Space';
        }
        
        const hotkeyString = [...modifiers, key].join('+');
        
        const input = document.getElementById(this.currentHotkeyTarget);
        if (input) {
            input.value = hotkeyString;
            input.placeholder = '';
        }
        
        this.isCapturingHotkey = false;
        this.currentHotkeyTarget = null;
    }
    
    clearHotkey(targetId) {
        const input = document.getElementById(targetId);

        if (input) {
            input.value = '';
        }
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
        this.currentMode = 'today';
        this.currentDate = null; // 今日の日付を示す
        
        // 日付検知を再初期化
        const now = new Date();
        this.lastKnownDate = now.toDateString();
        console.log('今日モード切り替え時の日付記録:', this.lastKnownDate);
        
        // UI更新
        document.getElementById('today-btn').classList.add('active');
        document.getElementById('history-btn').classList.remove('active');
        document.getElementById('date-selector').style.display = 'none';
        document.getElementById('current-time').style.display = 'block';
        document.getElementById('create-report-btn').style.display = 'flex';
        document.getElementById('goal-stock-btn').style.display = 'flex';
        document.getElementById('break-btn').style.display = 'flex';
        
        // 今日のタスクを再読み込み
        this.loadTasks();
        
        // 日付表示を更新
        this.updateDateTime();
    }
    
    switchToHistoryMode() {
        console.log('履歴モードに切り替え中...');
        this.currentMode = 'history';
        
        // UI更新
        document.getElementById('today-btn').classList.remove('active');
        document.getElementById('history-btn').classList.add('active');
        document.getElementById('date-selector').style.display = 'flex';
        document.getElementById('current-time').style.display = 'none';
        document.getElementById('create-report-btn').style.display = 'none';
        document.getElementById('goal-stock-btn').style.display = 'none';
        document.getElementById('break-btn').style.display = 'none';
        
        // 履歴日付を読み込み
        this.loadHistoryDates();
        
        // 既に日付が選択されている場合は、そのデータを読み込む
        const calendarInput = document.getElementById('calendar-date-input');
        const hasSelectedDate = calendarInput && calendarInput.value;
        const hasCurrentDate = this.currentDate;
        
        console.log('履歴モード切り替え時の状態確認:', {
            hasSelectedDate,
            hasCurrentDate,
            calendarInputValue: calendarInput?.value,
            currentDate: this.currentDate
        });
        
        if (hasSelectedDate || hasCurrentDate) {
            const dateToLoad = this.currentDate || calendarInput.value;
            console.log('履歴モード切り替え時に既存の日付データを読み込み:', dateToLoad);
            
            // データを読み込み
            this.loadHistoryData(dateToLoad);
            
            // 内部状態を同期
            this.currentDate = dateToLoad;
            
            // 日付表示を更新
            const date = new Date(dateToLoad);
            const displayDate = date.toLocaleDateString('ja-JP', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long'
            });
            document.getElementById('current-date').textContent = displayDate;
            console.log('日付表示を更新:', displayDate);
        } else {
            console.log('履歴モード切り替え時に選択された日付なし - 空の状態を表示');
            // 履歴が選択されていない状態のUI
            this.clearHistoryView();
        }
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
        document.getElementById('history-date-display').textContent = '日付を選択';
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
                
                if (result.success && result.data && result.data.tasks && result.data.tasks.length > 0) {
                    console.log('履歴データ:', result.data);
                    
                    // 履歴データをタイムラインに表示
                    this.renderHistoryTimeline(result.data);
                    
                    // 統計情報を更新
                    this.updateHistoryStats(result.data.tasks);
                } else {
                    console.log('履歴データが見つからないか、空のデータです');
                    // データがない場合は空の表示（日付指定済み）
                    this.renderEmptyHistory(dateString);
                }
            } else {
                console.error('履歴APIリクエストが失敗しました:', response.status);
                this.renderEmptyHistory(dateString);
            }
        } catch (error) {
            console.error('履歴データ読み込みエラー:', error);
            this.renderEmptyHistory(dateString);
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
            const isBreak = task.isBreak || false;
            
            // タスク名を表示用に整形
            let displayName = task.name || task.title || '名称未設定';
            if (isBreak) {
                displayName = '休憩';
            }
            
            // タグの表示
            const tagDisplay = task.tag ? `<span class="task-tag">${task.tag}</span>` : '';
            
            return `
                <div class="timeline-item">
                    <div class="timeline-time">${startTime}</div>
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
    
    renderEmptyHistory(dateString) {
        const container = document.getElementById('timeline-container');
        
        if (dateString) {
            // 日付が指定されている場合は、その日にデータがないことを表示
            const date = new Date(dateString);
            const displayDate = date.toLocaleDateString('ja-JP', {
                month: 'long',
                day: 'numeric'
            });
            
            container.innerHTML = `
                <div class="timeline-empty">
                    <span class="material-icons">calendar_today</span>
                    <p>${displayDate}のデータはありません</p>
                    <p class="sub-text">この日はタスクが記録されていません</p>
                </div>
            `;
            
            console.log(`空の履歴表示: ${displayDate}`);
        } else {
            // 日付が指定されていない場合は、日付選択を促す
            container.innerHTML = `
                <div class="timeline-empty">
                    <span class="material-icons">history</span>
                    <p>日付を選択してください</p>
                    <p class="sub-text">カレンダーから閲覧したい日付を選びます</p>
                </div>
            `;
            
            console.log('日付選択促進メッセージを表示');
        }
        
        // 統計情報もクリア
        document.getElementById('completed-tasks').textContent = dateString ? '0' : '-';
        document.getElementById('work-time').textContent = dateString ? '0:00' : '-';
        document.getElementById('productivity').textContent = '-';
    }
    
    updateHistoryStats(tasks) {
        const completedWorkTasks = tasks.filter(task => task.endTime && !task.isBreak).length;
        
        const totalMinutes = tasks.reduce((total, task) => {
            if (task.endTime && task.startTime && !task.isBreak) {
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
        
        const workTasks = tasks.filter(task => !task.isBreak);
        const productivity = workTasks.length > 0 ? `${Math.round(completedWorkTasks / workTasks.length * 100)}%` : '-';
        
        document.getElementById('completed-tasks').textContent = completedWorkTasks;
        document.getElementById('work-time').textContent = totalWorkTime;
        document.getElementById('productivity').textContent = productivity;
    }
    
    handleWindowRestored() {
        // 1. タイムラインを再読み込み
        if (this.currentMode === 'today') {
            this.loadTasks();
        } else if (this.currentMode === 'history' && this.currentDate) {
            this.loadHistoryData(this.currentDate);
        }
        
        // 2. 報告書ダイアログが開いている場合は内容を再読み込み
        if (document.getElementById('report-dialog').classList.contains('show')) {
            this.showReportDialog();
        }
        
        // 3. 設定ダイアログが開いている場合は内容を再読み込み
        if (document.getElementById('settings-dialog').classList.contains('show')) {
            this.openSettingsDialog();
        }
        
        // 4. タスク入力欄にフォーカス
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

        // 履歴データをチェック
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

        tagSelect.innerHTML = '<option value="">未選択</option>';
        
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

        tagSelect.innerHTML = '<option value="">未選択</option>';
        
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
