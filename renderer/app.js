class NippoApp {
    constructor() {
        this.tasks = [];
        this.currentTaskId = null;
        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.updateDateTime();
        this.updateTaskCounter();
        
        // APIサーバーの準備を待つ
        console.log('APIサーバーの準備を待機中...');
        await this.waitForAPI();
        
        // 起動時に既存データを読み込み
        console.log('アプリ起動時のデータ読み込み開始...');
        await this.loadTasks();
        
        // 1分ごとに時刻を更新
        setInterval(() => this.updateDateTime(), 60000);
    }

    async waitForAPI() {
        const maxRetries = 30; // 30秒まで待機
        for (let i = 0; i < maxRetries; i++) {
            try {
                console.log(`API接続確認 ${i + 1}/${maxRetries}...`);
                
                // Electron経由でヘルスチェック
                const result = await window.electronAPI.healthCheck();
                if (result.success) {
                    console.log('API接続成功 - サーバー準備完了');
                    return true;
                }
            } catch (error) {
                console.log(`API接続待機中... (${error.message})`);
            }
            
            // 1秒待機
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

        // タイムラインコピー
        document.getElementById('copy-timeline-btn').addEventListener('click', () => this.copyTimeline());

        // すべてクリア
        document.getElementById('clear-all-btn').addEventListener('click', () => this.showClearConfirmation());

        // タイトルバーボタン
        document.querySelector('.titlebar-button.minimize').addEventListener('click', () => {
            // 最小化処理（Electronのメインプロセスで処理）
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
    }

    updateDateTime() {
        const now = new Date();
        const dateElement = document.getElementById('current-date');
        const timeElement = document.getElementById('current-time');

        const dateStr = now.toLocaleDateString('ja-JP', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long'
        });

        const timeStr = now.toLocaleTimeString('ja-JP', {
            hour: '2-digit',
            minute: '2-digit'
        });

        dateElement.textContent = dateStr;
        timeElement.textContent = timeStr;
    }

    async addTask() {
        const taskInput = document.getElementById('task-input');
        const taskName = taskInput.value.trim();

        if (!taskName) {
            this.showToast('タスク名を入力してください', 'warning');
            return;
        }

        // 現在実行中のタスクがあるかチェック
        const currentRunningTask = this.tasks.find(task => !task.endTime);
        
        try {
            const result = await window.electronAPI.addTask(taskName);
            if (result.success) {
                taskInput.value = '';
                await this.loadTasks();
                
                // 前のタスクが自動終了された場合の通知
                if (currentRunningTask) {
                    this.showToast(`「${currentRunningTask.name}」を終了し、「${taskName}」を開始しました`);
                } else {
                    this.showToast(`タスク「${taskName}」を開始しました`);
                }
                
                // 現在のタスクを更新
                this.currentTaskId = result.taskId;
                this.updateCurrentTask(taskName);
            }
        } catch (error) {
            console.error('タスク追加エラー:', error);
            this.showToast('タスクの追加に失敗しました', 'error');
        }
    }

    async endTask() {
        // 実行中のタスクがあるかチェック
        const runningTask = this.tasks.find(task => !task.endTime);
        
        if (!runningTask) {
            this.showToast('終了するタスクがありません', 'warning');
            return;
        }

        try {
            const result = await window.electronAPI.endTask();
            if (result.success) {
                await this.loadTasks();
                this.showToast(`タスク「${runningTask.name}」を終了しました`);
                this.currentTaskId = null;
                this.updateCurrentTask('タスクなし');
            }
        } catch (error) {
            console.error('タスク終了エラー:', error);
            this.showToast('タスクの終了に失敗しました', 'error');
        }
    }

    async copyTimeline() {
        try {
            const result = await window.electronAPI.copyTimeline();
            if (result.success) {
                this.showToast('タイムラインをクリップボードにコピーしました');
            }
        } catch (error) {
            console.error('コピーエラー:', error);
            this.showToast('コピーに失敗しました', 'error');
        }
    }

    async loadTasks() {
        try {
            console.log('タスクデータの読み込みを開始...');
            const tasks = await window.electronAPI.getTasks();
            console.log('読み込まれたタスク数:', tasks.length);
            console.log('タスクデータ:', tasks);
            
            this.tasks = tasks;
            this.updateTimeline();
            this.updateStats();
            this.updateTaskCounter();
            
            // 現在実行中のタスクを更新
            const runningTask = this.tasks.find(task => !task.endTime);
            if (runningTask) {
                console.log('実行中のタスク:', runningTask.name);
                this.currentTaskId = runningTask.id;
                this.updateCurrentTask(runningTask.name);
            } else {
                console.log('実行中のタスクはありません');
                this.currentTaskId = null;
                this.updateCurrentTask('タスクなし');
            }
            
            console.log('タスクデータの読み込み完了');
        } catch (error) {
            console.error('タスク読み込みエラー:', error);
        }
    }

    updateTimeline() {
        const container = document.getElementById('timeline-container');
        
        if (this.tasks.length === 0) {
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
            
            // デバッグ情報
            if (task.endTime) {
                console.log('タスク詳細:', {
                    name: task.name,
                    startTime: task.startTime,
                    endTime: task.endTime,
                    duration: duration
                });
            }
            
            return `
                <div class="timeline-item ${isRunning ? 'running' : ''}">
                    <div class="timeline-time">${startTime}</div>
                    <div class="timeline-content">
                        <div class="timeline-task">${task.name}</div>
                        ${duration ? `<span class="timeline-duration">${duration}</span>` : ''}
                        ${isRunning ? '<span class="timeline-duration" style="background: var(--accent); color: white;">実行中</span>' : ''}
                    </div>
                    <button class="timeline-edit" onclick="app.editTask(${task.id})" title="編集">
                        <span class="material-icons">edit</span>
                    </button>
                </div>
            `;
        }).join('');

        container.innerHTML = timelineHTML;
    }

    updateStats() {
        const completedTasks = this.tasks.filter(task => task.endTime).length;
        const totalWorkTime = this.calculateTotalWorkTime();
        const productivity = this.calculateProductivity();

        document.getElementById('completed-tasks').textContent = completedTasks;
        document.getElementById('work-time').textContent = totalWorkTime;
        document.getElementById('productivity').textContent = productivity;
    }

    updateTaskCounter() {
        const activeTasks = this.tasks.filter(task => !task.endTime).length;
        document.getElementById('task-count').textContent = activeTasks;
    }

    updateCurrentTask(taskName) {
        document.getElementById('current-task').textContent = taskName;
    }

    formatTime(timeString) {
        // "午前 10:30" -> "10:30"
        if (!timeString) return '';
        return timeString.replace('午前 ', '').replace('午後 ', '');
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

    calculateTotalWorkTime() {
        const totalMinutes = this.tasks.reduce((total, task) => {
            if (task.endTime && task.startTime) {
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
        if (this.tasks.length === 0) return '-';
        const completedRatio = this.tasks.filter(task => task.endTime).length / this.tasks.length;
        return `${Math.round(completedRatio * 100)}%`;
    }

    showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        const messageElement = document.getElementById('toast-message');
        
        messageElement.textContent = message;
        
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
        }, 3000);
    }

    showClearConfirmation() {
        if (this.tasks.length === 0) {
            this.showToast('クリアするタスクがありません', 'warning');
            return;
        }

        const dialog = document.getElementById('confirm-dialog');
        const title = document.getElementById('confirm-title');
        const message = document.getElementById('confirm-message');
        
        title.textContent = 'すべてのタスクをクリア';
        message.textContent = 'すべてのタスクデータが削除されます。この操作は元に戻せません。本当に実行しますか？';
        
        this.pendingAction = 'clearAll';
        dialog.classList.add('show');
    }

    hideConfirmDialog() {
        const dialog = document.getElementById('confirm-dialog');
        dialog.classList.remove('show');
        this.pendingAction = null;
        this.pendingTaskId = null; // クリーンアップ
    }

    async executeConfirmedAction() {
        if (this.pendingAction === 'clearAll') {
            await this.clearAllTasks();
        }
        this.hideConfirmDialog();
    }

    async clearAllTasks() {
        try {
            const result = await window.electronAPI.clearAllTasks();
            if (result.success) {
                this.tasks = [];
                this.currentTaskId = null;
                this.updateTimeline();
                this.updateStats();
                this.updateTaskCounter();
                this.updateCurrentTask('タスクなし');
                this.showToast('すべてのタスクをクリアしました');
            } else {
                this.showToast('タスクのクリアに失敗しました', 'error');
            }
        } catch (error) {
            console.error('タスククリアエラー:', error);
            this.showToast('タスクのクリアに失敗しました', 'error');
        }
    }

    editTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) {
            this.showToast('タスクが見つかりません', 'error');
            return;
        }

        // 編集ダイアログに値を設定
        document.getElementById('edit-task-name').value = task.name;
        document.getElementById('edit-start-time').value = task.startTime;
        document.getElementById('edit-end-time').value = task.endTime || '';

        this.editingTaskId = taskId;
        this.showEditDialog();
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
        const startTime = document.getElementById('edit-start-time').value.trim();
        const endTime = document.getElementById('edit-end-time').value.trim();

        if (!taskName || !startTime) {
            this.showToast('タスク名と開始時刻は必須です', 'warning');
            return;
        }

        try {
            const taskData = {
                name: taskName,
                startTime: startTime,
                endTime: endTime
            };

            const result = await window.electronAPI.updateTask(this.editingTaskId, taskData);
            if (result.success) {
                await this.loadTasks();
                this.hideEditDialog();
                this.showToast('タスクを更新しました');
            } else {
                this.showToast('タスクの更新に失敗しました', 'error');
            }
        } catch (error) {
            console.error('タスク更新エラー:', error);
            this.showToast('タスクの更新に失敗しました', 'error');
        }
    }

    deleteCurrentTask() {
        const task = this.tasks.find(t => t.id === this.editingTaskId);
        if (!task) return;

        const dialog = document.getElementById('confirm-dialog');
        const title = document.getElementById('confirm-title');
        const message = document.getElementById('confirm-message');
        
        title.textContent = 'タスクを削除';
        message.textContent = `タスク「${task.name}」を削除しますか？この操作は元に戻せません。`;
        
        this.pendingAction = 'deleteTask';
        this.pendingTaskId = this.editingTaskId; // IDを保存
        this.hideEditDialog();
        dialog.classList.add('show');
    }

    async executeConfirmedAction() {
        if (this.pendingAction === 'clearAll') {
            await this.clearAllTasks();
        } else if (this.pendingAction === 'deleteTask') {
            await this.deleteTask();
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
            
            const result = await window.electronAPI.deleteTask(taskId);
            if (result.success) {
                await this.loadTasks();
                this.showToast('タスクを削除しました');
            } else {
                this.showToast('タスクの削除に失敗しました', 'error');
            }
        } catch (error) {
            console.error('タスク削除エラー:', error);
            this.showToast('タスクの削除に失敗しました', 'error');
        } finally {
            this.pendingTaskId = null; // クリーンアップ
        }
    }
}

// グローバルにアクセスできるようにする
let app;

// アプリケーション開始
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM読み込み完了 - アプリ初期化を開始');
    
    // 少し待ってからアプリを初期化（Electronプロセスの準備を待つ）
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('アプリケーションを初期化中...');
    app = new NippoApp();
});