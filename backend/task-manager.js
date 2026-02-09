const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class TaskManager {
    constructor(userDataPath = null) {
        // パッケージ化されたアプリではuserDataPathを使用、開発時は従来のパス
        this.dataDir = userDataPath ? path.join(userDataPath, 'datas') : path.join(__dirname, '..', 'datas');
        this.dataFile = path.join(this.dataDir, 'data.txt');
        this.taskListFile = path.join(this.dataDir, 'task_list.txt');
        this.reportFile = path.join(this.dataDir, 'report.txt');
        this.reportTabsFile = path.join(this.dataDir, 'report_tabs.json');
        this.urlsFile = path.join(this.dataDir, 'report_urls.json');
        this.historyDir = path.join(this.dataDir, 'history');
        
        this.initialized = false;

    // 時刻丸め設定（デフォルト: 丸めなし）
    this.timeRounding = { interval: 0, mode: 'nearest' };
    }

    isReservedTask(task) {
        return !!task && task.status === 'reserved';
    }

    getNowMinutes() {
        // 予約は「今日(JST)」前提の仕様のため、比較もJSTに寄せる
        const now = new Date();
        const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
        return jst.getHours() * 60 + jst.getMinutes();
    }

    async initialize() {
        if (!this.initialized) {
            console.log('TaskManager初期化開始...');
            await this.ensureDataDir();
            
            // 日付変更チェックとアーカイブ処理
            await this.checkAndArchivePreviousDay();
            
            // 既存履歴ファイルの混在データ修正（一度だけ実行）
            await this.fixAllMixedDateHistoryFiles();
            
            // 今日のファイルに蓄積された過去データをアーカイブ
            await this.archiveMixedDataFromToday();
            
            // 履歴の整合性をチェックして欠落した日付を補完
            try {
                console.log('履歴整合性チェックを実行します...');
                await this.ensureHistoryIntegrity();
                console.log('履歴整合性チェック完了');
            } catch (error) {
                console.error('履歴整合性チェックでエラーが発生しましたが、処理を継続します:', error);
            }

            // 休憩機能は廃止：過去データに残る休憩タスク（isBreak:true / [BREAK]）を保存データから除去
            try {
                await this.purgeLegacyBreakTasks();
            } catch (error) {
                console.error('休憩タスクのクリーンアップでエラーが発生しましたが、処理を継続します:', error);
            }
            
            this.initialized = true;
            console.log('TaskManager初期化完了 - データディレクトリ:', this.dataDir);
        }
    }

    shouldRemoveBreakTask(task) {
        if (!task) return false;
        if (task.isBreak === true) return true;
        const title = (task.name || task.title || '').toString();
        const normalized = title.trim();
        if (normalized === '休憩' || normalized === '休憩中') return true;
        if (title.includes('[BREAK]')) return true;
        return false;
    }

    async purgeLegacyBreakTasks() {
        const filesToCheck = [];

        // 今日のJSON（data_today.json）
        filesToCheck.push(path.join(this.dataDir, 'data_today.json'));

        // 履歴JSON（history/data_*.json）
        const historyExists = await fs.access(this.historyDir).then(() => true).catch(() => false);
        if (historyExists) {
            const files = await fs.readdir(this.historyDir);
            for (const filename of files) {
                if (filename.startsWith('data_') && filename.endsWith('.json')) {
                    filesToCheck.push(path.join(this.historyDir, filename));
                }
            }
        }

        let removedTotal = 0;
        let touchedFiles = 0;

        for (const filePath of filesToCheck) {
            const exists = await fs.access(filePath).then(() => true).catch(() => false);
            if (!exists) continue;

            let data;
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                data = JSON.parse(content);
            } catch (error) {
                console.error(`休憩タスククリーンアップ: JSON読み込み失敗: ${filePath}`, error);
                continue;
            }

            if (!data || !Array.isArray(data.tasks)) continue;

            const before = data.tasks.length;
            const filtered = data.tasks.filter(t => !this.shouldRemoveBreakTask(t));
            const removed = before - filtered.length;
            if (removed <= 0) continue;

            data.tasks = filtered;
            data.updatedAt = new Date().toISOString();

            try {
                await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
                removedTotal += removed;
                touchedFiles += 1;
                console.log(`休憩タスククリーンアップ: ${filePath} から ${removed} 件削除`);
            } catch (error) {
                console.error(`休憩タスククリーンアップ: 書き込み失敗: ${filePath}`, error);
            }
        }

        if (removedTotal > 0) {
            console.log(`休憩タスククリーンアップ完了: ${touchedFiles}ファイル / 合計${removedTotal}件削除`);
        }
    }

    // メインプロセスから設定を渡せるようにする（簡易）
    setTimeRoundingConfig(config) {
        if (!config) return;
        const interval = parseInt(config.interval, 10);
        const mode = config.mode || 'nearest';
        if (!isNaN(interval) && interval >= 0) {
            this.timeRounding = { interval, mode };
            console.log('時刻丸め設定を適用:', this.timeRounding);
        }
    }

    roundTime(now) {
        const interval = this.timeRounding?.interval || 0;
        if (!interval) return now; // 丸めなし
        const mode = this.timeRounding?.mode || 'nearest';
        const minutes = now.getMinutes();
        const remainder = minutes % interval;
        let adjMinutes = minutes;
        if (mode === 'floor') {
            adjMinutes = minutes - remainder;
        } else if (mode === 'ceil') {
            adjMinutes = remainder === 0 ? minutes : minutes + (interval - remainder);
        } else { // nearest
            adjMinutes = remainder < interval / 2 ? minutes - remainder : minutes + (interval - remainder);
        }
        const rounded = new Date(now);
        rounded.setSeconds(0, 0);
        // 繰り上がり/繰り下がり対応
        const delta = adjMinutes - minutes;
        rounded.setMinutes(minutes + delta);
        return rounded;
    }

    async ensureDataDir() {
        try {
            console.log('データディレクトリの存在確認と作成を開始します。');
            console.log(`ターゲットディレクトリ: ${this.dataDir}`);
            
            // recursive: true なので、親ディレクトリが存在しない場合も自動で作成されるはず
            await fs.mkdir(this.dataDir, { recursive: true });
            await fs.mkdir(this.historyDir, { recursive: true });
            
            console.log('データディレクトリの準備が完了しました。');
            
            // 念のため、書き込みテストを行う
            const testFilePath = path.join(this.dataDir, 'test-write.txt');
            console.log(`書き込みテストファイルパス: ${testFilePath}`);
            await fs.writeFile(testFilePath, 'test');
            await fs.unlink(testFilePath);
            console.log('データディレクトリの書き込みテストに成功しました。');

        } catch (error) {
            console.error('データディレクトリの作成または書き込みで致命的なエラーが発生しました。');
            console.error(`ターゲットディレクトリ: ${this.dataDir}`);
            console.error('エラー詳細:', error);
            console.error('エラースタックトレース:', error.stack);
            // このエラーを呼び出し元にスローして、アプリケーションの起動を停止させる
            throw error;
        }
    }

    async checkAndArchivePreviousDay() {
        try {
            const todayFile = path.join(this.dataDir, 'data_today.json');
            const exists = await fs.access(todayFile).then(() => true).catch(() => false);
            
            if (!exists) {
                console.log('data_today.json が存在しないため、アーカイブ処理をスキップします');
                return;
            }

            const content = await fs.readFile(todayFile, 'utf-8');
            const data = JSON.parse(content);
            const fileDate = data.date;
            const todayString = this.getTodayDateString();

            console.log(`ファイル内の日付: ${fileDate}, 今日の日付: ${todayString}`);

            if (fileDate && fileDate !== todayString) {
                console.log(`日付が変更されました。${fileDate} のデータを履歴にアーカイブします`);
                
                // タスクを日付別に分離してアーカイブ
                await this.archiveTasksByDate(data.tasks || [], fileDate);
                
                // 今日のファイルを新しい日付で初期化
                const newTodayData = {
                    date: todayString,
                    tasks: [],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                await fs.writeFile(todayFile, JSON.stringify(newTodayData, null, 2), 'utf-8');
                console.log(`data_today.json を新しい日付 ${todayString} で初期化完了`);
            } else {
                console.log('日付変更はありません');
            }
        } catch (error) {
            console.error('日付変更チェック・アーカイブ処理でエラーが発生:', error);
        }
    }

    async archiveTasksByDate(tasks, primaryDate) {
        try {
            // タスクを日付別にグループ化
            const tasksByDate = {};
            
            for (const task of tasks) {
                // タスクの日付を決定（taskDate、createdAt、またはプライマリ日付の順で使用）
                let taskDate = primaryDate;
                
                if (task.taskDate) {
                    taskDate = task.taskDate;
                } else if (task.createdAt) {
                    const createdDate = new Date(task.createdAt);
                    // OSのローカル時間（日本時間）で日付を確実に取得
                    // toLocaleDateStringを使用してローカルタイムゾーンでの日付を取得
                    const localDateParts = createdDate.toLocaleDateString('ja-JP', { 
                        year: 'numeric', 
                        month: '2-digit', 
                        day: '2-digit',
                        timeZone: 'Asia/Tokyo' // 明示的に日本時間を指定
                    }).split('/');
                    taskDate = `${localDateParts[0]}-${localDateParts[1]}-${localDateParts[2]}`;
                }
                
                if (!tasksByDate[taskDate]) {
                    tasksByDate[taskDate] = [];
                }
                tasksByDate[taskDate].push(task);
            }
            
            // 各日付のタスクを対応する履歴ファイルに保存
            for (const [date, dateTasks] of Object.entries(tasksByDate)) {
                const historyFile = path.join(this.historyDir, `data_${date}.json`);
                
                // 既存の履歴ファイルがあれば読み込み、なければ新規作成
                let existingData = {
                    date: date,
                    tasks: [],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                
                try {
                    const existingContent = await fs.readFile(historyFile, 'utf-8');
                    existingData = JSON.parse(existingContent);
                } catch (error) {
                    // ファイルが存在しない場合は新規作成
                    console.log(`新しい履歴ファイルを作成: ${historyFile}`);
                }
                
                // 重複チェックを行いながらタスクをマージ
                const existingTaskIds = new Set(existingData.tasks.map(t => t.id));
                const newTasks = dateTasks.filter(t => !existingTaskIds.has(t.id));
                
                existingData.tasks = [...existingData.tasks, ...newTasks];
                existingData.updatedAt = new Date().toISOString();
                
                await fs.writeFile(historyFile, JSON.stringify(existingData, null, 2), 'utf-8');
                console.log(`履歴ファイルに保存完了: ${historyFile} (${dateTasks.length}件のタスク)`);
            }
        } catch (error) {
            console.error('タスクの日付別アーカイブでエラーが発生:', error);
        }
    }

    async fixAllMixedDateHistoryFiles() {
        try {
            console.log('既存履歴ファイルの日付混在データ修正を開始...');
            
            // historyディレクトリの全ファイルを取得
            if (!await fs.access(this.historyDir).then(() => true).catch(() => false)) {
                console.log('履歴ディレクトリが存在しません');
                return;
            }
            
            const files = await fs.readdir(this.historyDir);
            const historyFiles = files.filter(file => file.startsWith('data_') && file.endsWith('.json'));
            
            for (const filename of historyFiles) {
                const filePath = path.join(this.historyDir, filename);
                const expectedDate = filename.match(/data_(\d{4}-\d{2}-\d{2})\.json/)?.[1];
                
                if (!expectedDate) continue;
                
                try {
                    const content = await fs.readFile(filePath, 'utf-8');
                    const data = JSON.parse(content);
                    
                    if (!data.tasks || data.tasks.length === 0) continue;
                    
                    console.log(`履歴ファイル ${filename} をチェック中... (期待日付: ${expectedDate})`);
                    
                    // 日付別にタスクをグループ化
                    const tasksByDate = {};
                    let hasMixedDates = false;
                    
                    for (const task of data.tasks) {
                        let taskDate = expectedDate;
                        
                        // taskDateがあればそれを使用、なければcreatedAtから日本時間で判定
                        if (task.taskDate) {
                            taskDate = task.taskDate;
                        } else if (task.createdAt) {
                            const createdDate = new Date(task.createdAt);
                            if (!isNaN(createdDate.getTime())) {
                                // OSのローカル時間（日本時間）で日付を確実に取得
                                const localDateParts = createdDate.toLocaleDateString('ja-JP', { 
                                    year: 'numeric', 
                                    month: '2-digit', 
                                    day: '2-digit',
                                    timeZone: 'Asia/Tokyo' // 明示的に日本時間を指定
                                }).split('/');
                                taskDate = `${localDateParts[0]}-${localDateParts[1]}-${localDateParts[2]}`;
                            }
                        }
                        
                        if (taskDate !== expectedDate) {
                            hasMixedDates = true;
                        }
                        
                        if (!tasksByDate[taskDate]) {
                            tasksByDate[taskDate] = [];
                        }
                        tasksByDate[taskDate].push(task);
                    }
                    
                    if (hasMixedDates) {
                        console.log(`${filename} に混在データを発見。日付別に分離します...`);
                        
                        // 各日付のタスクを対応する履歴ファイルに保存
                        for (const [taskDate, tasks] of Object.entries(tasksByDate)) {
                            const targetFile = path.join(this.historyDir, `data_${taskDate}.json`);
                            
                            let targetData = {
                                date: taskDate,
                                tasks: [],
                                createdAt: new Date().toISOString(),
                                updatedAt: new Date().toISOString()
                            };
                            
                            // 既存ファイルがあれば読み込み
                            try {
                                const existingContent = await fs.readFile(targetFile, 'utf-8');
                                targetData = JSON.parse(existingContent);
                            } catch (error) {
                                // ファイルが存在しない場合は新規作成
                                console.log(`新しい履歴ファイルを作成: ${targetFile}`);
                            }
                            
                            // タスクの重複チェックとマージ
                            const existingIds = new Set(targetData.tasks.map(t => t.id));
                            const newTasks = tasks.filter(t => !existingIds.has(t.id));
                            
                            if (newTasks.length > 0) {
                                targetData.tasks = [...targetData.tasks, ...newTasks];
                                targetData.updatedAt = new Date().toISOString();
                                
                                // ファイルに保存
                                await fs.writeFile(targetFile, JSON.stringify(targetData, null, 2), 'utf-8');
                                console.log(`${taskDate} の履歴ファイルに ${newTasks.length} 件のタスクを追加`);
                            }
                        }
                        
                        console.log(`${filename} の日付混在修正が完了しました`);
                    } else {
                        console.log(`${filename} は日付混在なし`);
                    }
                } catch (error) {
                    console.error(`履歴ファイル ${filename} の処理中にエラー:`, error);
                }
            }
            
            console.log('既存履歴ファイルの日付混在データ修正が完了');
        } catch (error) {
            console.error('履歴ファイル混在修正処理でエラー:', error);
        }
    }

    getTime() {
        /**現在の時間を取得して12時間表示に変換 */
        const now = new Date();
        const amOrPm = now.getHours() < 12 ? "午前" : "午後";
        
        // 11時の50分以降は次の時間にする
        if (now.getHours() === 11 && now.getMinutes() >= 50 && now.getMinutes() <= 59) {
            now.setMinutes(now.getMinutes() + 10);
            now.setMinutes(0);
        }
        
        // 12時間形式に変換
        let hour12 = now.getHours() % 12;
        if (hour12 === 0) {
            hour12 = 12;
        }
        
        const minute = now.getMinutes();
        return `${amOrPm} ${hour12}:${minute.toString().padStart(2, '0')}`;
    }

    getTodayDateString() {
        /**今日の日付文字列を取得 (YYYY-MM-DD形式) - OSのローカル時間（日本時間）を使用 */
        const today = new Date();
        // OSのローカル時間（日本時間）で日付を確実に取得
        const localDateParts = today.toLocaleDateString('ja-JP', { 
            year: 'numeric', 
            month: '2-digit', 
            day: '2-digit',
            timeZone: 'Asia/Tokyo' // 明示的に日本時間を指定
        }).split('/');
        return `${localDateParts[0]}-${localDateParts[1]}-${localDateParts[2]}`;
    }

    getTodayDataFile() {
        /**今日のデータファイルパスを取得 */
        const dateString = this.getTodayDateString();
        return path.join(this.historyDir, `data_${dateString}.json`);
    }

    getHistoryDataFile(dateString) {
        /**指定日のデータファイルパスを取得 */
        return path.join(this.historyDir, `data_${dateString}.json`);
    }

    getDataFileForDate(dateString = null) {
        /**指定日のデータファイルパス取得（JSON形式統一） */
        if (!dateString) {
            // 今日の場合は特別なファイル名
            return path.join(this.dataDir, 'data_today.json');
        }
        // 過去日付の場合は従来の履歴ファイル形式
        return path.join(this.historyDir, `data_${dateString}.json`);
    }

    async syncTaskToHistory(task, dateString = null) {
        /**タスクを履歴にリアルタイム同期 */
        try {
            const taskDate = dateString || this.getTodayDateString();
            console.log(`履歴同期開始: ${taskDate}, タスクID: ${task.id}`);
            
            const historyFile = this.getHistoryDataFile(taskDate);
            
            // 履歴データを読み込み
            let historyData;
            const exists = await fs.access(historyFile).then(() => true).catch(() => false);
            
            if (exists) {
                const content = await fs.readFile(historyFile, 'utf-8');
                historyData = JSON.parse(content);
            } else {
                historyData = {
                    date: taskDate,
                    tasks: [],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
            }
            
            // 既存タスクを検索（同じIDのタスクがあれば更新、なければ追加）
            const existingIndex = historyData.tasks.findIndex(t => t.id === task.id);
            
            // タスクデータを履歴形式に変換
            const historyTask = {
                id: task.id,
                startTime: task.startTime,
                endTime: task.endTime || null,
                title: task.name || task.title,
                tag: task.tag || null,
                createdAt: task.createdAt,
                updatedAt: new Date().toISOString(),
                date: taskDate
            };
            
            if (existingIndex !== -1) {
                // 既存タスクを更新
                historyData.tasks[existingIndex] = historyTask;
                console.log(`履歴タスクを更新: ${task.id}`);
            } else {
                // 新規タスクを追加
                historyData.tasks.push(historyTask);
                console.log(`履歴タスクを追加: ${task.id}`);
            }
            
            historyData.updatedAt = new Date().toISOString();
            
            await fs.writeFile(historyFile, JSON.stringify(historyData, null, 2), 'utf-8');
            console.log(`履歴同期完了: ${historyFile}`);
            
            return { success: true };
        } catch (error) {
            console.error('履歴同期エラー:', error);
            return { success: false, error: error.message };
        }
    }

    async removeTaskFromHistory(taskId, dateString = null) {
        /**タスクを履歴から削除 */
        try {
            const taskDate = dateString || this.getTodayDateString();
            console.log(`履歴からタスク削除開始: ${taskDate}, タスクID: ${taskId}`);
            
            const historyFile = this.getHistoryDataFile(taskDate);
            
            // 履歴データを読み込み
            const exists = await fs.access(historyFile).then(() => true).catch(() => false);
            if (!exists) {
                console.log('履歴ファイルが存在しないため、削除処理をスキップ');
                return { success: true };
            }
            
            const content = await fs.readFile(historyFile, 'utf-8');
            const historyData = JSON.parse(content);
            
            // タスクを検索して削除
            const initialLength = historyData.tasks.length;
            historyData.tasks = historyData.tasks.filter(t => t.id !== taskId);
            
            if (historyData.tasks.length < initialLength) {
                historyData.updatedAt = new Date().toISOString();
                await fs.writeFile(historyFile, JSON.stringify(historyData, null, 2), 'utf-8');
                console.log(`履歴からタスクを削除完了: ${taskId}`);
            } else {
                console.log(`履歴にタスクが見つかりませんでした: ${taskId}`);
            }
            
            return { success: true };
        } catch (error) {
            console.error('履歴削除エラー:', error);
            return { success: false, error: error.message };
        }
    }

    async loadSchedule(dateString = null) {
        /**スケジュールデータを読み込む（JSON形式統一） */
        await this.initialize();
        
        // 日付が指定されている場合は履歴から読み込み
        if (dateString) {
            return await this.loadHistoryTasks(dateString);
        }
        
        // 今日のデータを読み込み
        const jsonFile = this.getDataFileForDate();
        console.log(`JSONデータファイルのパス: ${jsonFile}`);
        
        try {
            const exists = await fs.access(jsonFile).then(() => true).catch(() => false);
            console.log(`JSONデータファイルの存在: ${exists}`);
            
            if (exists) {
                const content = await fs.readFile(jsonFile, 'utf-8');
                const data = JSON.parse(content);
                const tasks = data.tasks || [];
                
                // レガシー形式との互換性のため、IDとnameフィールドを調整
                const compatibleTasks = tasks.map((task, index) => ({
                    id: task.id || `task-${index + 1}`, // 既存IDを保持、なければ生成
                    startTime: task.startTime,
                    endTime: task.endTime,
                    name: task.title || task.name,
                    tag: task.tag,
                    status: task.status || null,
                    createdAt: task.createdAt,
                    updatedAt: task.updatedAt
                }));
                
                console.log(`JSON読み込み完了 - タスク数: ${compatibleTasks.length}`);
                return compatibleTasks;
            } else {
                // JSONファイルが存在しない場合、レガシーTXTファイルからの移行を試行
                return await this.migrateFromLegacyFormat();
            }
        } catch (error) {
            console.error(`JSON読み込みエラー: ${error}`);
            // JSONパースエラーの場合もレガシー移行を試行
            return await this.migrateFromLegacyFormat();
        }
    }

    async loadHistoryTasks(dateString) {
        /**履歴タスクを読み込み */
        const historyFile = this.getHistoryDataFile(dateString);
        
        try {
            const exists = await fs.access(historyFile).then(() => true).catch(() => false);
            if (!exists) {
                return [];
            }
            
            const content = await fs.readFile(historyFile, 'utf-8');
            const data = JSON.parse(content);
            const tasks = data.tasks || [];
            
            // レガシー形式との互換性のため、IDとnameフィールドを調整
            const compatibleTasks = tasks.map((task, index) => ({
                id: task.id || `task-${index + 1}`, // 既存IDを保持、なければ生成
                startTime: task.startTime,
                endTime: task.endTime,
                name: task.title || task.name,
                tag: task.tag,
                status: task.status || null,
                createdAt: task.createdAt,
                updatedAt: task.updatedAt
            }));
            
            console.log(`履歴読み込み完了 - 日付: ${dateString}, タスク数: ${compatibleTasks.length}`);
            return compatibleTasks;
        } catch (error) {
            console.error(`履歴読み込みエラー: ${error}`);
            return [];
        }
    }

    async saveSchedule(tasks, dateString = null) {
        /**スケジュールデータを保存（JSON形式統一） */
        await this.initialize();
        
        try {
            const dataFile = this.getDataFileForDate(dateString);
            console.log(`saveSchedule開始 - ファイルパス: ${dataFile}`);
            
            // JSON形式でデータを構築
            const jsonData = {
                date: dateString || this.getTodayDateString(),
                tasks: tasks.map((task, index) => {
                    return {
                        id: task.id !== undefined ? task.id : `task-${index + 1}`, // 既存IDを保持
                        startTime: task.startTime || '',
                        endTime: task.endTime || null,
                        title: task.name || task.title || '',
                        tag: task.tag || null,
                        status: task.status || null,
                        createdAt: task.createdAt || new Date().toISOString(), // 既存作成日時を保持
                        updatedAt: new Date().toISOString() // 更新日時のみ新しく設定
                    };
                }),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            console.log(`保存するタスク数: ${tasks.length}`);
            
            await fs.writeFile(dataFile, JSON.stringify(jsonData, null, 2), 'utf-8');
            console.log(`スケジュール保存完了: ${tasks.length}件`);
            
        } catch (error) {
            console.error(`save_scheduleエラー: ${error}`);
            console.error(`エラータイプ: ${error.constructor.name}`);
            console.error(`エラーコード: ${error.code}`);
            console.error(`エラースタック: ${error.stack}`);
            throw error; // エラーを再スロー
        }
    }

    async migrateFromLegacyFormat() {
        /**レガシーTXTファイルからJSONに移行 */
        try {
            console.log('レガシーTXTファイルからの移行を開始...');
            const exists = await fs.access(this.dataFile).then(() => true).catch(() => false);
            
            if (!exists) {
                console.log('レガシーファイルが存在しません - 空のタスクリストを返します');
                return [];
            }
            
            const content = await fs.readFile(this.dataFile, 'utf-8');
            if (!content.trim()) {
                console.log('レガシーファイルが空です');
                return [];
            }
            
            // 既存のconvertTextToJsonメソッドを使用
            const jsonData = await this.convertTextToJson(content);
            
            // JSON形式で今日のファイルとして保存
            const jsonFile = this.getDataFileForDate();
            await fs.writeFile(jsonFile, JSON.stringify(jsonData, null, 2), 'utf-8');
            console.log(`レガシーデータをJSONに移行完了: ${jsonFile}`);
            
            // レガシーファイルをバックアップとして残す
            const backupFile = this.dataFile + '.backup';
            await fs.rename(this.dataFile, backupFile);
            console.log(`レガシーファイルをバックアップ: ${backupFile}`);
            
            // レガシー形式との互換性のため、IDとnameフィールドを調整
            const tasks = jsonData.tasks || [];
            const compatibleTasks = tasks.map((task, index) => ({
                id: index,
                startTime: task.startTime,
                endTime: task.endTime,
                status: task.status || null,
                name: task.title || task.name,
                tag: task.tag || null
            }));
            
            console.log(`移行完了 - タスク数: ${compatibleTasks.length}`);
            return compatibleTasks;
            
        } catch (error) {
            console.error(`レガシー移行エラー: ${error}`);
            return [];
        }
    }

    async addTask(taskName, isBreak = false, dateString = null, tag = null, startTime = null, _userId = null, memo = '', url = '') {
        /**タスクを追加 */
        await this.initialize();
        try {
            // 休憩機能は廃止：後方互換のため引数は受けるが常に通常タスクとして扱う
            const requestedIsBreak = !!isBreak;
            isBreak = false;

            console.log(
                `add_task開始: name='${taskName}', requestedIsBreak=${requestedIsBreak}, dateString=${dateString}, tag=${tag}, startTime=${startTime}`
            );

            const tasks = await this.loadSchedule(dateString);
            console.log(`既存タスク数: ${tasks.length}`);

            // 開始時刻を決定：指定された時刻があればそれを使用、なければ現在時刻
            const addTime = startTime || this.getTimeForDate(dateString);
            console.log(
                `使用する開始時刻: ${addTime} (指定時刻: ${startTime}, 現在時刻: ${startTime ? 'スキップ' : this.getTimeForDate(dateString)})`
            );

            // この追加が属する日付（履歴同期用）を先に決定しておく
            const taskDate = dateString || this.getTodayDateString();

            // 未終了のタスクがあれば終了時刻を設定（予約は除外）
            for (const task of tasks) {
                if (!task.endTime && !this.isReservedTask(task)) {
                    try {
                        console.log(`未終了タスクを終了: ${JSON.stringify(task)}`);
                    } catch (error) {
                        console.log(`未終了タスクを終了: [絵文字を含むタスク] ID=${task.id}`);
                    }

                    task.endTime = addTime;
                    task.updatedAt = new Date().toISOString();

                    // 未終了タスクの終了も履歴に同期
                    await this.syncTaskToHistory(task, taskDate);
                }
            }

            // 新しいタスクを追加
            const now = new Date();
            const newTask = {
                id: `task-${tasks.length + 1}`, // 一貫した文字列ID形式
                startTime: addTime,
                endTime: '',
                name: taskName,
                tag: tag || '',
                memo: typeof memo === 'string' ? memo : '',
                url: typeof url === 'string' ? url : '',
                status: null,
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
                taskDate: taskDate // タスクが属する日付を明示的に記録
            };

            tasks.push(newTask);
            try {
                console.log(`新しいタスクを追加: ${JSON.stringify(newTask)}`);
            } catch (error) {
                console.log(`新しいタスクを追加: [絵文字を含むタスク] ID=${newTask.id}`);
            }

            await this.saveSchedule(tasks, dateString);

            // 履歴にもリアルタイム同期
            await this.syncTaskToHistory(newTask, taskDate);

            console.log('add_task完了');
            return newTask;
        } catch (error) {
            console.error(`add_taskエラー: ${error}`);
            console.error(`エラースタック: ${error.stack}`);
            console.error(`データディレクトリ存在チェック: ${this.dataDir}`);
            
            // ファイル書き込み権限をチェック
            try {
                const testFile = path.join(this.dataDir, 'test.txt');
                await fs.writeFile(testFile, 'test', 'utf-8');
                await fs.unlink(testFile);
                console.log('ファイル書き込み権限: OK');
            } catch (permError) {
                console.error(`ファイル書き込み権限エラー: ${permError}`);
            }
            
            throw error; // エラーを再スローして詳細を上位に伝える
        }
    }

    getTimeForDate(dateString = null) {
        /**指定日付の現在時刻を取得（日付は指定、時刻は現在時刻） */
    let now = new Date();
        console.log(`getTimeForDate呼び出し - dateString: ${dateString}, 現在時刻: ${now.toISOString()}`);
    // 丸めを適用
    now = this.roundTime(now);
        
        const amOrPm = now.getHours() < 12 ? "午前" : "午後";
        
        // 11時の50分以降は次の時間にする
        if (now.getHours() === 11 && now.getMinutes() >= 50 && now.getMinutes() <= 59) {
            now.setMinutes(now.getMinutes() + 10);
            now.setMinutes(0);
        }
        
        // 12時間形式に変換
        let hour12 = now.getHours() % 12;
        if (hour12 === 0) {
            hour12 = 12;
        }
        
        const minute = now.getMinutes();
        const formattedTime = `${amOrPm} ${hour12}:${minute.toString().padStart(2, '0')}`;
        
        console.log(`生成された時刻: ${formattedTime}`);
        return formattedTime;
    }

    async endCurrentTask(dateString = null) {
        /**現在のタスクを終了 */
        const tasks = await this.loadSchedule(dateString);
    const addTime = this.getTimeForDate(dateString);
        
        console.log(`終了処理開始 - 時刻: ${addTime}, 日付: ${dateString || '今日'}`);
        console.log(`読み込んだタスク数: ${tasks.length}`);
        
        // 未終了のタスクを探して終了時刻を設定（予約は除外）
        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            console.log(`タスク${i}: ${JSON.stringify(task)}`);
            if (!task.endTime && !this.isReservedTask(task)) {
                console.log(`未終了タスクを発見: ${task.name}`);
                task.endTime = addTime;
                task.updatedAt = new Date().toISOString();
                await this.saveSchedule(tasks, dateString);
                
                // 履歴にもリアルタイム同期
                await this.syncTaskToHistory(task, dateString);
                
                console.log(`タスクを終了しました: ${JSON.stringify(task)}`);
                return task;
            }
        }
        
        console.log("未終了のタスクが見つかりませんでした");
        return null;
    }

    async getTimelineText() {
        /**タイムラインのテキストを取得 */
        try {
            const exists = await fs.access(this.dataFile).then(() => true).catch(() => false);
            if (!exists) {
                return "";
            }
            
            const content = await fs.readFile(this.dataFile, 'utf-8');

            // 休憩（[BREAK]）行は廃止済みのため除去
            return content
                .split('\n')
                .filter(line => !line.trim().startsWith('[BREAK]'))
                .join('\n');
        } catch (error) {
            console.error(`getTimelineTextエラー: ${error}`);
            return "";
        }
    }

    async convertTextToJson(textContent) {
        /**テキストファイルの内容をJSONに変換 */
        const lines = textContent.split('\n').filter(line => line.trim());
        const tasks = [];
        let currentTask = null;
        let taskId = 1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // 行番号を削除
            const content = line.replace(/^\d+→/, '');
            
            // 時間範囲の行かチェック
            if (content.includes('~')) {
                if (currentTask) {
                    tasks.push(currentTask);
                }
                
                const timeRange = content.trim();
                // 休憩（[BREAK]）は廃止：レガシーデータ移行時にスキップ
                if (timeRange.includes('[BREAK]')) {
                    currentTask = null;
                    continue;
                }
                const [startTimeStr, endTimeStr] = timeRange.split('~').map(s => s.trim());
                
                currentTask = {
                    id: `task-${taskId++}`,
                    startTime: startTimeStr,
                    endTime: endTimeStr || null,
                    title: '',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
            } else if (currentTask) {
                // タスク名の行
                if (content.includes('[BREAK]')) {
                    // 休憩は廃止：このタスク自体を破棄
                    currentTask = null;
                    continue;
                }
                currentTask.title = content;
            }
        }

        if (currentTask) {
            tasks.push(currentTask);
        }

        return {
            date: this.getTodayDateString(),
            tasks: tasks,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }

    async archiveCurrentTasks() {
        /**現在のタスクを履歴として保存 */
        try {
            const exists = await fs.access(this.dataFile).then(() => true).catch(() => false);
            if (!exists) {
                return { success: true, message: '保存するタスクがありません' };
            }

            const textContent = await fs.readFile(this.dataFile, 'utf-8');
            if (!textContent.trim()) {
                return { success: true, message: '保存するタスクがありません' };
            }

            const jsonData = await this.convertTextToJson(textContent);
            const todayFile = this.getTodayDataFile();
            
            await fs.writeFile(todayFile, JSON.stringify(jsonData, null, 2), 'utf-8');
            console.log(`タスクを履歴に保存しました: ${todayFile}`);
            
            return { success: true, message: 'タスクを履歴に保存しました' };
        } catch (error) {
            console.error(`タスク履歴保存エラー: ${error}`);
            return { success: false, message: 'タスクの履歴保存に失敗しました' };
        }
    }

    async clearAllTasks() {
        /**すべてのタスクをクリア（履歴保存付き） */
        try {
            // 現在のタスクを履歴に保存
            const archiveResult = await this.archiveCurrentTasks();
            if (!archiveResult.success) {
                return false;
            }

            // 現在のデータファイルを削除
            const exists = await fs.access(this.dataFile).then(() => true).catch(() => false);
            if (exists) {
                await fs.unlink(this.dataFile);
            }
            
            return true;
        } catch (error) {
            console.error(`タスククリアエラー: ${error}`);
            return false;
        }
    }

    async clearAllTimelineData() {
        /**すべてのタイムラインデータを完全削除（履歴含む） */
        try {
            console.log('すべてのタイムラインデータを削除中...');
            
            // レガシーTXTファイルを削除
            const legacyExists = await fs.access(this.dataFile).then(() => true).catch(() => false);
            if (legacyExists) {
                await fs.unlink(this.dataFile);
                console.log('レガシーTXTファイルを削除しました:', this.dataFile);
            }
            
            // レガシーバックアップファイルも削除
            const backupFile = this.dataFile + '.backup';
            const backupExists = await fs.access(backupFile).then(() => true).catch(() => false);
            if (backupExists) {
                await fs.unlink(backupFile);
                console.log('レガシーバックアップファイルを削除しました:', backupFile);
            }
            
            // 今日のJSONファイルを削除
            const todayJsonFile = this.getDataFileForDate();
            const todayExists = await fs.access(todayJsonFile).then(() => true).catch(() => false);
            if (todayExists) {
                await fs.unlink(todayJsonFile);
                console.log('今日のJSONファイルを削除しました:', todayJsonFile);
            }

            // 履歴ディレクトリ内のすべてのファイルを削除
            const historyExists = await fs.access(this.historyDir).then(() => true).catch(() => false);
            if (historyExists) {
                const files = await fs.readdir(this.historyDir);
                const jsonFiles = files.filter(file => file.endsWith('.json'));
                
                for (const file of jsonFiles) {
                    const filePath = path.join(this.historyDir, file);
                    await fs.unlink(filePath);
                    console.log(`履歴ファイルを削除しました: ${file}`);
                }
                
                console.log(`${jsonFiles.length}個の履歴ファイルを削除しました`);
            }
            
            console.log('すべてのタイムラインデータの削除が完了しました');
            return true;
        } catch (error) {
            console.error(`全タイムラインデータ削除エラー: ${error}`);
            return false;
        }
    }

    async addReservation(taskName, startTime, tag = null, dateString = null, _userId = null, memo = '', url = '') {
        await this.initialize();

        const trimmedName = (taskName || '').trim();
        if (!trimmedName) {
            throw new Error('タスク名が必要です');
        }
        if (!startTime) {
            throw new Error('開始時間が必要です');
        }

        const tasks = await this.loadSchedule(dateString);
        const reserveMinutes = this.parseTimeToMinutes(startTime);
        if (reserveMinutes === null) {
            throw new Error('開始時間の形式が不正です');
        }

        // 1) 同時刻の予約は不可
        const hasSameReservation = tasks.some(t => this.isReservedTask(t) && this.parseTimeToMinutes(t.startTime) === reserveMinutes);
        if (hasSameReservation) {
            throw new Error('その時刻には既に予約があります');
        }

        // 2) 既存タスクの時間帯に被る場合は不可（終了時刻があるタスクのみ）
        const conflicts = tasks.some(t => {
            if (!t || !t.startTime) return false;
            if (!t.endTime) return false; // 実行中タスクは未来の割当が確定しないためブロックしない

            const start = this.parseTimeToMinutes(t.startTime);
            const end = this.parseTimeToMinutes(t.endTime);
            if (start === null || end === null) return false;
            if (end <= start) return false;

            return reserveMinutes >= start && reserveMinutes < end;
        });

        if (conflicts) {
            throw new Error('その時刻には既にタスクが割り当てられています');
        }

        const now = new Date();
        const taskDate = dateString || this.getTodayDateString();
        const newReservation = {
            id: `resv-${now.getTime()}`,
            startTime: startTime,
            endTime: null,
            name: trimmedName,
            tag: tag || '',
            memo: typeof memo === 'string' ? memo : '',
            url: typeof url === 'string' ? url : '',
            status: 'reserved',
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            taskDate: taskDate
        };

        tasks.push(newReservation);
        await this.saveSchedule(tasks, dateString);
        await this.syncTaskToHistory(newReservation, taskDate);
        return newReservation;
    }

    async processDueReservations() {
        await this.initialize();

        const tasks = await this.loadSchedule(null);
        const nowMinutes = this.getNowMinutes();

        const dueReservations = tasks
            .filter(t => this.isReservedTask(t))
            .map(t => ({ task: t, minutes: this.parseTimeToMinutes(t.startTime) }))
            .filter(x => x.minutes !== null && x.minutes <= nowMinutes)
            .sort((a, b) => a.minutes - b.minutes);

        if (dueReservations.length === 0) {
            return { changed: false };
        }

        // 複数が同時刻/過去に溜まっていても、時系列で順に開始する
        let changed = false;
        const taskDate = this.getTodayDateString();

        for (const due of dueReservations) {
            const reservation = due.task;
            const startTime = reservation.startTime;
            if (!startTime) continue;

            // 既に予約ステータスが外れている場合（他処理で開始済み）
            if (!this.isReservedTask(reservation)) continue;

            // 予約開始時刻で、実行中タスク（予約以外）を終了
            for (const t of tasks) {
                if (t && !t.endTime && !this.isReservedTask(t)) {
                    t.endTime = startTime;
                    t.updatedAt = new Date().toISOString();
                    await this.syncTaskToHistory(t, taskDate);
                    changed = true;
                }
            }

            // 予約を通常の実行中タスクへ切り替え
            reservation.status = null;
            reservation.endTime = null;
            reservation.updatedAt = new Date().toISOString();
            await this.syncTaskToHistory(reservation, taskDate);
            changed = true;
        }

        if (changed) {
            await this.saveSchedule(tasks, null);
        }

        return { changed };
    }

    async getAllHistoryDates() {
        /**履歴の日付一覧を取得（今日の日付は除外） */
        try {
            console.log('getAllHistoryDates開始');
            await this.initialize();
            console.log('initialize完了 - historyDir:', this.historyDir);
            
            // まず履歴の整合性をチェックして欠落した日付を補完
            await this.ensureHistoryIntegrity();
            
            const files = await fs.readdir(this.historyDir);
            console.log('読み込んだファイル一覧:', files);
            
            // 今日の日付を取得
            const todayString = this.getTodayDateString();
            console.log('今日の日付:', todayString);
            
            const dates = files
                .filter(file => file.startsWith('data_') && file.endsWith('.json'))
                .map(file => file.replace('data_', '').replace('.json', ''))
                .filter(date => date !== todayString) // 今日の日付を除外
                .sort()
                .reverse(); // 新しい日付から並べる
            
            console.log('抽出した日付一覧（今日を除く）:', dates);
            const result = { success: true, dates: dates };
            console.log('getAllHistoryDates結果:', result);
            return result;
        } catch (error) {
            console.error(`履歴日付取得エラー: ${error}`);
            return { success: false, dates: [] };
        }
    }

    async cleanupHistoryByDate(targetDate) {
        /**指定された日付の履歴ファイルから、その日付以外のタスクを除去 */
        try {
            console.log(`履歴クリーンアップ開始: ${targetDate}`);
            await this.initialize();
            
            const historyFile = path.join(this.historyDir, `data_${targetDate}.json`);
            
            // ファイルの存在確認
            try {
                await fs.access(historyFile);
            } catch (error) {
                console.log(`履歴ファイルが存在しません: ${historyFile}`);
                return { success: true, message: 'ファイルが存在しないため、クリーンアップ不要です' };
            }
            
            // ファイルを読み込み
            const content = await fs.readFile(historyFile, 'utf-8');
            const data = JSON.parse(content);
            
            if (!data.tasks || data.tasks.length === 0) {
                console.log('タスクが存在しないため、クリーンアップ不要です');
                return { success: true, message: 'タスクが存在しないため、クリーンアップ不要です' };
            }
            
            console.log(`クリーンアップ前のタスク数: ${data.tasks.length}`);
            console.log('クリーンアップ前のタスク:', data.tasks.map(t => ({
                id: t.id,
                name: t.name || t.title,
                createdAt: t.createdAt,
                startTime: t.startTime
            })));
            
            // 指定された日付のタスクのみを残す
            const targetDateISO = targetDate; // "2025-07-30" 形式
            const filteredTasks = data.tasks.filter(task => {
                if (task.createdAt) {
                    const taskDate = new Date(task.createdAt);
                    // OSのローカル時間（日本時間）で日付を確実に取得
                    const localDateParts = taskDate.toLocaleDateString('ja-JP', { 
                        year: 'numeric', 
                        month: '2-digit', 
                        day: '2-digit',
                        timeZone: 'Asia/Tokyo' // 明示的に日本時間を指定
                    }).split('/');
                    const taskDateISO = `${localDateParts[0]}-${localDateParts[1]}-${localDateParts[2]}`;
                    const isValidTask = taskDateISO === targetDateISO;
                    
                    if (!isValidTask) {
                        console.log(`除外するタスク: ${task.name || task.title} (作成日時: ${task.createdAt}, 期待日付: ${targetDateISO}, 実際日付: ${taskDateISO})`);
                    }
                    
                    return isValidTask;
                }
                
                // createdAtがない場合は残す（安全のため）
                console.log(`createdAtがないタスクは残します: ${task.name || task.title}`);
                return true;
            });
            
            console.log(`クリーンアップ後のタスク数: ${filteredTasks.length}`);
            
            // クリーンアップ結果をファイルに書き戻し
            const cleanedData = {
                ...data,
                tasks: filteredTasks,
                updatedAt: new Date().toISOString()
            };
            
            await fs.writeFile(historyFile, JSON.stringify(cleanedData, null, 2), 'utf-8');
            
            const removedCount = data.tasks.length - filteredTasks.length;
            console.log(`履歴クリーンアップ完了: ${removedCount}件のタスクを除去しました`);
            
            return { 
                success: true, 
                message: `${removedCount}件の不正なタスクを除去しました`,
                originalCount: data.tasks.length,
                cleanedCount: filteredTasks.length,
                removedCount: removedCount
            };
            
        } catch (error) {
            console.error(`履歴クリーンアップエラー: ${error}`);
            return { success: false, message: 'クリーンアップに失敗しました', error: error.message };
        }
    }

    async loadHistoryByDate(dateString) {
        /**指定日の履歴を読み込み */
        try {
            await this.initialize();
            const historyFile = this.getHistoryDataFile(dateString);
            const exists = await fs.access(historyFile).then(() => true).catch(() => false);
            
            if (!exists) {
                return { success: false, message: '指定された日付の履歴が見つかりません' };
            }

            const content = await fs.readFile(historyFile, 'utf-8');
            const data = JSON.parse(content);
            
            return { success: true, data: data };
        } catch (error) {
            console.error(`履歴読み込みエラー: ${error}`);
            return { success: false, message: '履歴の読み込みに失敗しました' };
        }
    }

    async ensureHistoryIntegrity() {
        /**履歴の整合性を確保：欠落した日付の空ファイルを作成 */
        try {
            console.log('履歴整合性チェック開始...');
            
            // 最初の履歴ファイルの日付を取得
            const files = await fs.readdir(this.historyDir);
            const historyFiles = files
                .filter(file => file.startsWith('data_') && file.endsWith('.json'))
                .map(file => file.replace('data_', '').replace('.json', ''))
                .sort();
            
            if (historyFiles.length === 0) {
                console.log('履歴ファイルが存在しないため、整合性チェックをスキップ');
                return;
            }
            
            const startDate = new Date(historyFiles[0]);
            const today = new Date();
            
            // 開始日から昨日まで、1日ずつチェック
            const currentDate = new Date(startDate);
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            
            console.log(`履歴整合性チェック範囲: ${this.formatDateForFilename(currentDate)} ～ ${this.formatDateForFilename(yesterday)}`);
            
            let createdCount = 0;
            
            while (currentDate <= yesterday) {
                const dateString = this.formatDateForFilename(currentDate);
                const historyFile = path.join(this.historyDir, `data_${dateString}.json`);
                
                const fileExists = await fs.access(historyFile).then(() => true).catch(() => false);
                
                if (!fileExists) {
                    console.log(`欠落した履歴ファイルを作成: ${dateString}`);
                    
                    const emptyHistoryData = {
                        date: dateString,
                        tasks: [],
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        note: '自動生成された空の履歴ファイル'
                    };
                    
                    await fs.writeFile(historyFile, JSON.stringify(emptyHistoryData, null, 2), 'utf-8');
                    createdCount++;
                }
                
                currentDate.setDate(currentDate.getDate() + 1);
            }
            
            if (createdCount > 0) {
                console.log(`履歴整合性チェック完了: ${createdCount}件の空履歴ファイルを作成しました`);
            } else {
                console.log('履歴整合性チェック完了: 欠落なし');
            }
            
        } catch (error) {
            console.error('履歴整合性チェックエラー:', error);
        }
    }

    formatDateForFilename(date) {
        /**日付をファイル名用の文字列に変換 (YYYY-MM-DD) */
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    async archiveMixedDataFromToday() {
        /**今日のファイルに蓄積された過去データを適切な履歴ファイルに移動 */
        try {
            console.log('今日のファイルの混在データアーカイブを開始...');
            
            const todayFile = path.join(this.dataDir, 'data_today.json');
            const todayDateString = this.getTodayDateString();
            
            // 今日のファイルが存在しない場合は処理をスキップ
            if (!await fs.access(todayFile).then(() => true).catch(() => false)) {
                console.log('今日のファイルが存在しないため、混在データアーカイブをスキップ');
                return;
            }
            
            const content = await fs.readFile(todayFile, 'utf-8');
            const data = JSON.parse(content);
            
            if (!data.tasks || data.tasks.length === 0) {
                console.log('今日のファイルにタスクがないため、混在データアーカイブをスキップ');
                return;
            }
            
            // タスクを日付別にグループ化
            const tasksByDate = {};
            const todayTasks = [];
            
            for (const task of data.tasks) {
                let taskDateString = todayDateString; // デフォルトは今日
                
                if (task.createdAt) {
                    const createdDate = new Date(task.createdAt);
                    // OSのローカル時間（日本時間）で日付を確実に取得
                    const localDateParts = createdDate.toLocaleDateString('ja-JP', { 
                        year: 'numeric', 
                        month: '2-digit', 
                        day: '2-digit',
                        timeZone: 'Asia/Tokyo'
                    }).split('/');
                    taskDateString = `${localDateParts[0]}-${localDateParts[1]}-${localDateParts[2]}`;
                }
                
                if (taskDateString === todayDateString) {
                    // 今日のタスクは今日のファイルに残す
                    todayTasks.push(task);
                } else {
                    // 過去のタスクは履歴ファイルに移動
                    if (!tasksByDate[taskDateString]) {
                        tasksByDate[taskDateString] = [];
                    }
                    tasksByDate[taskDateString].push(task);
                }
            }
            
            let archivedCount = 0;
            
            // 過去のタスクを履歴ファイルに保存
            for (const [date, dateTasks] of Object.entries(tasksByDate)) {
                const historyFile = path.join(this.historyDir, `data_${date}.json`);
                
                // 既存の履歴ファイルを読み込み
                let existingData = {
                    date: date,
                    tasks: [],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                
                try {
                    const existingContent = await fs.readFile(historyFile, 'utf-8');
                    existingData = JSON.parse(existingContent);
                } catch (error) {
                    console.log(`新しい履歴ファイルを作成: ${historyFile}`);
                }
                
                // 重複チェックを行いながらタスクを追加
                const existingTaskIds = new Set(existingData.tasks.map(t => t.id));
                const newTasks = dateTasks.filter(t => !existingTaskIds.has(t.id));
                
                if (newTasks.length > 0) {
                    existingData.tasks = [...existingData.tasks, ...newTasks];
                    existingData.updatedAt = new Date().toISOString();
                    
                    await fs.writeFile(historyFile, JSON.stringify(existingData, null, 2), 'utf-8');
                    console.log(`履歴ファイルに移動: ${historyFile} (${newTasks.length}件のタスク)`);
                    archivedCount += newTasks.length;
                }
            }
            
            // 今日のファイルを今日のタスクのみに更新
            if (archivedCount > 0) {
                const updatedTodayData = {
                    date: todayDateString,
                    tasks: todayTasks,
                    createdAt: data.createdAt || new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                
                await fs.writeFile(todayFile, JSON.stringify(updatedTodayData, null, 2), 'utf-8');
                console.log(`今日のファイルを更新完了: ${archivedCount}件の過去タスクをアーカイブし、${todayTasks.length}件の今日のタスクを残しました`);
            } else {
                console.log('混在データアーカイブ完了: アーカイブすべき過去データなし');
            }
            
        } catch (error) {
            console.error('今日のファイルの混在データアーカイブでエラーが発生:', error);
        }
    }

    async updateHistoryByDate(dateString, data) {
        /**指定日の履歴を更新 */
        try {
            await this.initialize();
            const historyFile = this.getHistoryDataFile(dateString);
            
            // 更新日時を追加
            data.updatedAt = new Date().toISOString();
            
            await fs.writeFile(historyFile, JSON.stringify(data, null, 2), 'utf-8');
            console.log(`履歴を更新しました: ${historyFile}`);
            
            return { success: true, message: '履歴を更新しました' };
        } catch (error) {
            console.error(`履歴更新エラー: ${error}`);
            return { success: false, message: '履歴の更新に失敗しました' };
        }
    }

    async addTaskToHistory(dateString, taskData) {
        /**指定日の履歴にタスクを追加 */
        try {
            console.log(`addTaskToHistory開始: dateString=${dateString}, taskData=`, taskData);
            await this.initialize();
            
            // 日付形式の検証
            if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
                console.error('無効な日付形式:', dateString);
                return { success: false, message: '無効な日付形式です' };
            }
            
            // タスクデータの検証
            if (!taskData.title || !taskData.startTime) {
                console.error('必須フィールドが不足:', taskData);
                return { success: false, message: 'タスク名と開始時刻は必須です' };
            }
            
            const historyFile = this.getHistoryDataFile(dateString);
            console.log(`履歴ファイルパス: ${historyFile}`);
            
            // 履歴データを読み込み
            const exists = await fs.access(historyFile).then(() => true).catch(() => false);
            let historyData;
            
            if (exists) {
                console.log('既存の履歴ファイルを読み込み中...');
                const content = await fs.readFile(historyFile, 'utf-8');
                historyData = JSON.parse(content);
            } else {
                console.log('新しい履歴ファイルを作成中...');
                // 履歴データが存在しない場合は新規作成
                historyData = {
                    date: dateString,
                    tasks: [],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
            }
            
            // 新しいタスクを追加
            const newTask = {
                id: `task-${Date.now()}`,
                startTime: taskData.startTime,
                endTime: taskData.endTime || null,
                title: taskData.title,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            console.log('追加するタスク:', newTask);
            historyData.tasks.push(newTask);
            historyData.updatedAt = new Date().toISOString();
            
            await fs.writeFile(historyFile, JSON.stringify(historyData, null, 2), 'utf-8');
            console.log(`履歴にタスクを追加しました: ${historyFile}`);
            
            return { success: true, message: 'タスクを追加しました', data: historyData };
        } catch (error) {
            console.error(`履歴タスク追加エラー: ${error.message}`, error);
            return { success: false, message: `タスクの追加に失敗しました: ${error.message}` };
        }
    }

    async createNewHistoryForDate(dateString) {
        /**指定日の新しい履歴ファイルを作成 */
        try {
            await this.initialize();
            const historyFile = this.getHistoryDataFile(dateString);
            
            // 既にファイルが存在する場合は何もしない
            const exists = await fs.access(historyFile).then(() => true).catch(() => false);
            if (exists) {
                return { success: false, message: 'この日付のデータは既に存在します' };
            }
            
            // 新しい履歴データを作成
            const newHistoryData = {
                date: dateString,
                tasks: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            await fs.writeFile(historyFile, JSON.stringify(newHistoryData, null, 2), 'utf-8');
            console.log(`新しい履歴を作成しました: ${historyFile}`);
            
            return { success: true, message: '新しい履歴を作成しました', data: newHistoryData };
        } catch (error) {
            console.error(`履歴作成エラー: ${error}`);
            return { success: false, message: '履歴の作成に失敗しました' };
        }
    }

    parseTimeToMinutes(timeStr) {
        /**時間文字列を分に変換（比較用） */
        try {
            if (!timeStr) {
                return null;
            }

            const raw = String(timeStr).trim();
            if (!raw.includes(':')) return null;

            // 24時間形式: "HH:mm" / "H:mm"
            const hhmmMatch = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
            if (hhmmMatch) {
                const hour = parseInt(hhmmMatch[1], 10);
                const minute = parseInt(hhmmMatch[2], 10);
                return hour * 60 + minute;
            }

            // 12時間形式(日本語): "午前 10:30" / "午後 3:05"
            const hasAm = raw.includes('午前');
            const hasPm = raw.includes('午後');
            if (!hasAm && !hasPm) return null;

            const timeOnly = raw.replace('午前', '').replace('午後', '').trim();
            const parts = timeOnly.split(':');
            if (parts.length !== 2) return null;
            let hour = parseInt(parts[0], 10);
            const minute = parseInt(parts[1], 10);
            if (Number.isNaN(hour) || Number.isNaN(minute)) return null;

            // 12時間形式を24時間形式に変換
            if (hasPm && hour !== 12) hour += 12;
            if (hasAm && hour === 12) hour = 0;

            return hour * 60 + minute;
        } catch (error) {
            return null;
        }
    }

    minutesToTimeStr(minutes) {
        /**分を時間文字列に変換 */
        try {
            if (minutes === null || minutes === undefined) {
                return "";
            }
            
            const hour = Math.floor(minutes / 60);
            const minute = minutes % 60;
            
            // 24時間形式を12時間形式に変換
            if (hour === 0) {
                return `午前 12:${minute.toString().padStart(2, '0')}`;
            } else if (hour < 12) {
                return `午前 ${hour}:${minute.toString().padStart(2, '0')}`;
            } else if (hour === 12) {
                return `午後 12:${minute.toString().padStart(2, '0')}`;
            } else {
                return `午後 ${hour - 12}:${minute.toString().padStart(2, '0')}`;
            }
        } catch (error) {
            return "";
        }
    }

    adjustConflictingTasks(tasks, editedTaskId, newStartTime, newEndTime) {
        /**時間矛盾を解決するためにタスクを調整 */
        const adjustments = [];
        
        if (editedTaskId < 0 || editedTaskId >= tasks.length) {
            return { tasks, adjustments };
        }
        
        const newStartMinutes = this.parseTimeToMinutes(newStartTime);
        const newEndMinutes = this.parseTimeToMinutes(newEndTime);
        
        if (newStartMinutes === null) {
            return { tasks, adjustments };
        }
        
        // 前のタスクとの矛盾をチェック
        if (editedTaskId > 0) {
            const prevTask = tasks[editedTaskId - 1];
            if (prevTask.endTime) {
                const prevEndMinutes = this.parseTimeToMinutes(prevTask.endTime);
                if (prevEndMinutes && prevEndMinutes > newStartMinutes) {
                    // 前のタスクの終了時間を調整
                    prevTask.endTime = this.minutesToTimeStr(newStartMinutes);
                    adjustments.push({
                        taskId: editedTaskId - 1,
                        field: 'endTime',
                        oldValue: this.minutesToTimeStr(prevEndMinutes),
                        newValue: prevTask.endTime,
                        reason: '次のタスクとの重複を解消'
                    });
                }
            }
        }
        
        // 次のタスクとの矛盾をチェック
        if (newEndMinutes && editedTaskId < tasks.length - 1) {
            const nextTask = tasks[editedTaskId + 1];
            const nextStartMinutes = this.parseTimeToMinutes(nextTask.startTime);
            if (nextStartMinutes && nextStartMinutes < newEndMinutes) {
                // 次のタスクの開始時間を調整
                nextTask.startTime = this.minutesToTimeStr(newEndMinutes);
                adjustments.push({
                    taskId: editedTaskId + 1,
                    field: 'startTime',
                    oldValue: this.minutesToTimeStr(nextStartMinutes),
                    newValue: nextTask.startTime,
                    reason: '前のタスクとの重複を解消'
                });
            }
        }
        
        return { tasks, adjustments };
    }

    async updateTask(taskId, taskName, startTime, endTime, tag = null) {
        /**タスクを更新 */
        try {
            const tasks = await this.loadSchedule();
            
            const taskIndex = tasks.findIndex(task => task.id == taskId);

            if (taskIndex !== -1) {
                const status = tasks[taskIndex].status || null;
                
                // 時間矛盾を調整
                const { tasks: adjustedTasks, adjustments } = this.adjustConflictingTasks(
                    tasks, taskIndex, startTime, endTime
                );
                
                // 編集対象のタスクを更新
                adjustedTasks[taskIndex].name = taskName;
                adjustedTasks[taskIndex].startTime = startTime;
                adjustedTasks[taskIndex].endTime = endTime && endTime.trim() ? endTime : null;
                adjustedTasks[taskIndex].tag = tag;
                adjustedTasks[taskIndex].status = status;
                adjustedTasks[taskIndex].updatedAt = new Date().toISOString();
                
                await this.saveSchedule(adjustedTasks);
                
                // 履歴にもリアルタイム同期
                await this.syncTaskToHistory(adjustedTasks[taskIndex]);
                
                return {
                    task: adjustedTasks[taskIndex],
                    adjustments: adjustments
                };
            }
            console.log(`更新対象のタスクが見つかりません - ID: ${taskId}`);
            return null;
        } catch (error) {
            console.error(`タスク更新エラー: ${error}`);
            console.error(error.stack);
            return null;
        }
    }

    async updateHistoryTask(dateString, taskId, taskName, startTime, endTime, tag = null) {
        /**履歴タスクを更新 */
        try {
            console.log(`履歴タスク更新: ${dateString}, taskId: ${taskId}`);
            
            // 履歴ファイルパスを取得
            const historyFile = this.getDataFileForDate(dateString);
            
            // 履歴データを読み込み
            const historyData = await this.loadHistoryByDate(dateString);
            if (!historyData.success || !historyData.data || !historyData.data.tasks) {
                return { success: false, message: '履歴データが見つかりません' };
            }
            
            const tasks = historyData.data.tasks;
            console.log('履歴タスク一覧:', tasks.map(t => ({ id: t.id, name: t.name || t.title })));
            console.log('探しているタスクID:', taskId, typeof taskId);
            
            // タスクIDの比較を柔軟に行う（文字列/数値の違いを考慮）
            const taskIndex = tasks.findIndex(task => {
                console.log(`比較中: task.id="${task.id}" (${typeof task.id}) vs taskId="${taskId}" (${typeof taskId})`);
                
                // まず完全一致を試行
                if (task.id === taskId) {
                    return true;
                }
                
                // 文字列と数値の混在パターンを処理
                if (typeof task.id === 'string' && typeof taskId === 'number') {
                    const match = task.id.match(/\d+/);
                    const taskIdNum = match ? parseInt(match[0]) : null;
                    console.log(`文字列→数値比較: taskIdNum=${taskIdNum} vs taskId=${taskId}`);
                    return taskIdNum === taskId;
                }
                
                if (typeof task.id === 'number' && typeof taskId === 'string') {
                    const match = taskId.match(/\d+/);
                    const searchIdNum = match ? parseInt(match[0]) : null;
                    console.log(`数値→文字列比較: task.id=${task.id} vs searchIdNum=${searchIdNum}`);
                    return task.id === searchIdNum;
                }
                
                return false;
            });
            
            console.log('見つかったタスクのインデックス:', taskIndex);
            
            if (taskIndex === -1) {
                return { success: false, message: '指定されたタスクが見つかりません' };
            }
            
            // 既存のステータスとIDを保持
            const originalId = tasks[taskIndex].id;
            const status = tasks[taskIndex].status || null;
            
            // タスクを更新
            tasks[taskIndex] = {
                id: originalId,
                name: taskName,
                startTime: startTime,
                endTime: endTime && endTime.trim() ? endTime : null,
                tag: tag,
                status: status,
                createdAt: tasks[taskIndex].createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            // 履歴データを保存
            const updatedData = {
                ...historyData.data,
                tasks: tasks
            };
            
            await this.saveSchedule(tasks, dateString);
            
            console.log(`履歴タスク更新完了: ${dateString}, taskId: ${taskId}`);
            
            return {
                success: true,
                task: tasks[taskIndex],
                data: updatedData
            };
        } catch (error) {
            console.error(`履歴タスク更新エラー: ${error}`);
            console.error(error.stack);
            return { success: false, message: '履歴タスクの更新に失敗しました', error: error.message };
        }
    }

    async deleteTask(taskId) {
        /**タスクを削除 */
        try {
            console.log(`deleteTask開始 - taskId: ${taskId} (${typeof taskId})`);
            const tasks = await this.loadSchedule();
            console.log(`削除前のタスク一覧:`, tasks.map(t => ({ id: t.id, name: t.name })));
            
            // タスクIDの比較を柔軟に行う（文字列/数値の違いを考慮）
            const taskIndex = tasks.findIndex(task => {
                // まず完全一致を試行
                if (task.id === taskId) {
                    return true;
                }
                
                // 文字列と数値の混在パターンを処理
                if (typeof task.id === 'string' && typeof taskId === 'number') {
                    const match = task.id.match(/\d+/);
                    const taskIdNum = match ? parseInt(match[0]) : null;
                    return taskIdNum === taskId;
                }
                
                if (typeof task.id === 'number' && typeof taskId === 'string') {
                    const match = taskId.match(/\d+/);
                    const searchIdNum = match ? parseInt(match[0]) : null;
                    return task.id === searchIdNum;
                }
                
                return false;
            });
            
            console.log(`見つかったタスクのインデックス: ${taskIndex}`);
            
            if (taskIndex !== -1) {
                const deletedTask = tasks.splice(taskIndex, 1)[0];
                console.log(`削除されたタスク:`, deletedTask);
                
                // 削除後にJSONファイルに保存（IDの再振りは行わない）
                await this.saveSchedule(tasks);
                
                // 履歴からもリアルタイム削除
                await this.removeTaskFromHistory(deletedTask.id);
                
                console.log(`タスク削除完了`);
                return deletedTask;
            }
            
            console.log(`タスクが見つかりませんでした - ID: ${taskId}`);
            return null;
        } catch (error) {
            console.error(`タスク削除エラー: ${error}`);
            return null;
        }
    }

    async deleteHistoryTask(dateString, taskId) {
        /**履歴タスクを削除 */
        try {
            console.log(`deleteHistoryTask開始 - dateString: ${dateString}, taskId: ${taskId} (${typeof taskId})`);
            
            // 履歴データを読み込み
            const historyData = await this.loadHistoryByDate(dateString);
            if (!historyData.success || !historyData.data || !historyData.data.tasks) {
                return { success: false, message: '履歴データが見つかりません' };
            }
            
            const tasks = historyData.data.tasks;
            console.log('削除前の履歴タスク一覧:', tasks.map(t => ({ id: t.id, name: t.name || t.title })));
            
            // タスクIDの比較を柔軟に行う（文字列/数値の違いを考慮）
            const taskIndex = tasks.findIndex(task => {
                // まず完全一致を試行
                if (task.id === taskId) {
                    return true;
                }
                
                // 文字列と数値の混在パターンを処理
                if (typeof task.id === 'string' && typeof taskId === 'number') {
                    const match = task.id.match(/\d+/);
                    const taskIdNum = match ? parseInt(match[0]) : null;
                    return taskIdNum === taskId;
                }
                
                if (typeof task.id === 'number' && typeof taskId === 'string') {
                    const match = taskId.match(/\d+/);
                    const searchIdNum = match ? parseInt(match[0]) : null;
                    return task.id === searchIdNum;
                }
                
                return false;
            });
            
            console.log(`見つかった履歴タスクのインデックス: ${taskIndex}`);
            
            if (taskIndex !== -1) {
                const deletedTask = tasks.splice(taskIndex, 1)[0];
                console.log(`削除された履歴タスク:`, deletedTask);
                
                // 履歴ファイルに保存
                const historyFile = this.getDataFileForDate(dateString);
                const updatedData = {
                    ...historyData.data,
                    tasks: tasks,
                    updatedAt: new Date().toISOString()
                };
                
                await this.saveSchedule(tasks, dateString);
                console.log(`履歴タスク削除完了`);
                return { success: true, task: deletedTask };
            }
            
            console.log(`履歴タスクが見つかりませんでした - ID: ${taskId}`);
            return { success: false, message: '指定されたタスクが見つかりません' };
        } catch (error) {
            console.error(`履歴タスク削除エラー: ${error}`);
            return { success: false, message: '履歴タスクの削除に失敗しました', error: error.message };
        }
    }

    async saveReport(content) {
        /**報告書を保存 */
        try {
            await fs.writeFile(this.reportFile, content, 'utf-8');
            return true;
        } catch (error) {
            console.error(`報告書保存エラー: ${error}`);
            return false;
        }
    }

    async loadReport() {
        /**報告書を読み込み */
        try {
            const exists = await fs.access(this.reportFile).then(() => true).catch(() => false);
            if (exists) {
                return await fs.readFile(this.reportFile, 'utf-8');
            }
            return "";
        } catch (error) {
            console.error(`報告書読み込みエラー: ${error}`);
            return "";
        }
    }

    async saveReportUrls(urls) {
        /**報告先URLリストを保存 */
        try {
            await fs.writeFile(this.urlsFile, JSON.stringify(urls, null, 2), 'utf-8');
            return true;
        } catch (error) {
            console.error(`URL保存エラー: ${error}`);
            return false;
        }
    }

    async loadReportUrls() {
        /**報告先URLリストを読み込み */
        try {
            const exists = await fs.access(this.urlsFile).then(() => true).catch(() => false);
            if (exists) {
                const content = await fs.readFile(this.urlsFile, 'utf-8');
                return JSON.parse(content);
            }
            return [];
        } catch (error) {
            console.error(`URL読み込みエラー: ${error}`);
            return [];
        }
    }

    async addReportUrl(name, url) {
        /**報告先URLを追加 */
        try {
            const urls = await this.loadReportUrls();
            const newUrl = {
                id: urls.length,
                name: name,
                url: url
            };
            urls.push(newUrl);
            if (await this.saveReportUrls(urls)) {
                return newUrl;
            }
            return null;
        } catch (error) {
            console.error(`URL追加エラー: ${error}`);
            return null;
        }
    }

    async deleteReportUrl(urlId) {
        /**報告先URLを削除 */
        try {
            const urls = await this.loadReportUrls();
            if (urlId >= 0 && urlId < urls.length) {
                const deletedUrl = urls.splice(urlId, 1)[0];
                // IDを再振り
                urls.forEach((url, i) => {
                    url.id = i;
                });
                if (await this.saveReportUrls(urls)) {
                    // 関連する報告タブデータも削除
                    await this.cleanupReportTabData(urlId);
                    return deletedUrl;
                }
            }
            return null;
        } catch (error) {
            console.error(`URL削除エラー: ${error}`);
            return null;
        }
    }

    async saveReportTabs(tabData) {
        /**報告先別の報告内容を保存 */
        try {
            await fs.writeFile(this.reportTabsFile, JSON.stringify(tabData, null, 2), 'utf-8');
            return true;
        } catch (error) {
            console.error(`報告タブデータ保存エラー: ${error}`);
            return false;
        }
    }

    async loadReportTabs() {
        /**報告先別の報告内容を読み込み */
        try {
            const exists = await fs.access(this.reportTabsFile).then(() => true).catch(() => false);
            if (exists) {
                const content = await fs.readFile(this.reportTabsFile, 'utf-8');
                return JSON.parse(content);
            }
            return {};
        } catch (error) {
            console.error(`報告タブデータ読み込みエラー: ${error}`);
            return {};
        }
    }

    async saveReportTabContent(urlId, content) {
        /**特定の報告先の報告内容を保存 */
        try {
            const tabData = await this.loadReportTabs();
            tabData[String(urlId)] = content;
            return await this.saveReportTabs(tabData);
        } catch (error) {
            console.error(`報告タブ内容保存エラー: ${error}`);
            return false;
        }
    }

    async getReportTabContent(urlId) {
        /**特定の報告先の報告内容を取得 */
        try {
            const tabData = await this.loadReportTabs();
            return tabData[String(urlId)] || '';
        } catch (error) {
            console.error(`報告タブ内容取得エラー: ${error}`);
            return '';
        }
    }

    async cleanupReportTabData(deletedUrlId) {
        /**削除された報告先の報告データをクリーンアップ */
        try {
            const tabData = await this.loadReportTabs();
            
            // 削除された報告先のデータを削除
            if (String(deletedUrlId) in tabData) {
                delete tabData[String(deletedUrlId)];
            }
            
            // IDの再振りに対応してデータを調整
            const currentUrls = await this.loadReportUrls();
            const newTabData = {};
            
            for (let i = 0; i < currentUrls.length; i++) {
                const url = currentUrls[i];
                const oldId = url.original_id || i; // 元のIDを保持していればそれを使用
                if (String(oldId) in tabData) {
                    newTabData[String(i)] = tabData[String(oldId)];
                } else if (String(i) in tabData) {
                    newTabData[String(i)] = tabData[String(i)];
                }
            }
            
            return await this.saveReportTabs(newTabData);
        } catch (error) {
            console.error(`報告タブデータクリーンアップエラー: ${error}`);
            return false;
        }
    }

    async migrateLegacyReportData() {
        /**既存の単一報告書データを新形式に移行 */
        try {
            // 既存のレポートファイルがあるか確認
            const reportExists = await fs.access(this.reportFile).then(() => true).catch(() => false);
            const tabsExists = await fs.access(this.reportTabsFile).then(() => true).catch(() => false);
            
            if (reportExists && !tabsExists) {
                const legacyContent = await this.loadReport();
                if (legacyContent.trim()) {
                    // デフォルトタブとして保存
                    const tabData = { 'default': legacyContent };
                    if (await this.saveReportTabs(tabData)) {
                        console.log("既存の報告書データを新形式に移行しました");
                        return true;
                    }
                }
            }
            return true;
        } catch (error) {
            console.error(`データ移行エラー: ${error}`);
            return false;
        }
    }

    // Goal stock management
    async loadGoalStock() {
        await this.initialize();
        const goalStockFile = path.join(this.dataDir, 'goal_stock.json');
        try {
            const data = await fs.readFile(goalStockFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.log('Goal stock file not found, returning empty array');
            return [];
        }
    }

    async saveGoalStock(goals) {
        await this.initialize();
        const goalStockFile = path.join(this.dataDir, 'goal_stock.json');
        try {
            await fs.writeFile(goalStockFile, JSON.stringify(goals, null, 2));
            console.log('Goal stock saved successfully');
        } catch (error) {
            console.error('Error saving goal stock:', error);
            throw error;
        }
    }

    // Task stock management
    async loadTaskStock() {
        await this.initialize();
        const taskStockFile = path.join(this.dataDir, 'task_stock.json');
        try {
            const data = await fs.readFile(taskStockFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.log('Task stock file not found, returning empty array');
            return [];
        }
    }

    async saveTaskStock(tasks) {
        await this.initialize();
        const taskStockFile = path.join(this.dataDir, 'task_stock.json');
        try {
            await fs.writeFile(taskStockFile, JSON.stringify(tasks, null, 2));
            console.log('Task stock saved successfully');
        } catch (error) {
            console.error('Error saving task stock:', error);
            throw error;
        }
    }

    // Tag stock management
    async loadTagStock() {
        await this.initialize();
        const tagStockFile = path.join(this.dataDir, 'tag_stock.json');
        try {
            const data = await fs.readFile(tagStockFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.log('Tag stock file not found, returning empty array');
            return [];
        }
    }

    async saveTagStock(tags) {
        await this.initialize();
        const tagStockFile = path.join(this.dataDir, 'tag_stock.json');
        try {
            await fs.writeFile(tagStockFile, JSON.stringify(tags, null, 2));
            console.log('Tag stock saved successfully');
        } catch (error) {
            console.error('Error saving tag stock:', error);
            throw error;
        }
    }
}

// Express app setup
function createApp(taskManagerInstance, options = {}) {
    const app = express();
    const taskManager = taskManagerInstance;

    app.use(cors());
    app.use(express.json());

    if (typeof options.beforeRoutes === 'function') {
        options.beforeRoutes(app);
    }

    // API endpoints
    app.get('/api/tasks', async (req, res) => {
        try {
            const dateString = req.query.dateString || null; // クエリパラメータから日付取得

            // 予約は「今日のみ」要件のため、今日の取得時だけ予約の期限到来を処理してから返す
            if (!dateString && typeof taskManager.processDueReservations === 'function') {
                try {
                    await taskManager.processDueReservations(req.userId);
                } catch (e) {
                    console.warn('processDueReservations failed (ignored):', e);
                }
            }

            const tasks = await taskManager.loadSchedule(dateString, req.userId);
            console.log(`API - 取得したタスク数: ${tasks.length}, 日付: ${dateString || '今日'}`);
            tasks.forEach(task => {
                try {
                    console.log(`API - タスク: ${JSON.stringify(task)}`);
                } catch (error) {
                    console.log(`API - タスク: [絵文字を含むタスク] ID=${task.id}`);
                }
            });
            res.json({ success: true, tasks: tasks });
        } catch (error) {
            console.error(`API - タスク取得エラー: ${error}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/tasks', async (req, res) => {
        try {
            const data = req.body;
            const taskName = (data.name || '').trim();
            // 休憩機能は廃止：互換目的で受けても無視
            const requestedIsBreak = !!data.isBreak;
            const dateString = data.dateString || null; // 日付パラメータ追加
            const tag = data.tag || null; // タグパラメータ追加
            const startTime = data.startTime || null; // 開始時刻パラメータ追加
            const memo = typeof data.memo === 'string' ? data.memo : '';
            const url = typeof data.url === 'string' ? data.url : '';
            
            console.log(`API - タスク追加リクエスト: name='${taskName}', requestedIsBreak=${requestedIsBreak}, dateString=${dateString}, tag=${tag}, startTime=${startTime}`);
            
            if (!taskName) {
                return res.status(400).json({ success: false, error: 'タスク名が必要です' });
            }
            
            const newTask = await taskManager.addTask(taskName, false, dateString, tag, startTime, req.userId, memo, url);
            try {
                console.log(`API - 追加されたタスク: ${JSON.stringify(newTask)}`);
            } catch (error) {
                console.log(`API - 追加されたタスク: [絵文字を含むタスク] ID=${newTask ? newTask.id : 'None'}`);
            }
            res.json({
                success: true, 
                task: newTask,
                taskId: newTask.id
            });
        } catch (error) {
            console.error(`API - タスク追加エラー: ${error}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/tasks/reserve', async (req, res) => {
        try {
            const data = req.body;
            const taskName = (data.name || '').trim();
            const tag = data.tag || null;
            const startTime = data.startTime || null;
            const dateString = data.dateString || null;
            const memo = typeof data.memo === 'string' ? data.memo : '';
            const url = typeof data.url === 'string' ? data.url : '';

            if (!taskName) {
                return res.status(400).json({ success: false, error: 'タスク名が必要です' });
            }
            if (!startTime) {
                return res.status(400).json({ success: false, error: '開始時間が必要です' });
            }

            if (dateString) {
                const ds = String(dateString);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
                    return res.status(400).json({ success: false, error: '日付の形式が不正です' });
                }
                const todayJst = taskManager.getTodayDateString();
                if (ds < todayJst) {
                    return res.status(400).json({ success: false, error: '過去の日付には予約できません' });
                }
            }

            const newReservation = await taskManager.addReservation(taskName, startTime, tag, dateString, req.userId, memo, url);
            res.json({ success: true, task: newReservation, taskId: newReservation.id });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    app.post('/api/tasks/end', async (req, res) => {
        try {
            const endedTask = await taskManager.endCurrentTask(null, req.userId);
            if (endedTask) {
                res.json({ success: true, task: endedTask });
            } else {
                res.status(400).json({ success: false, error: '終了するタスクがありません' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/timeline/copy', async (req, res) => {
        try {
            const timelineText = await taskManager.getTimelineText(null, req.userId);
            if (timelineText) {
                // Note: このHTTP APIは使用されなくなったが、互換性のため残す
                res.json({ success: true, message: 'タイムラインをコピーしました' });
            } else {
                res.status(400).json({ success: false, error: 'コピーするデータがありません' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/tasks/clear', async (req, res) => {
        try {
            const success = await taskManager.clearAllTasks(req.userId);
            if (success) {
                res.json({ success: true, message: 'すべてのタスクをクリアしました' });
            } else {
                res.status(500).json({ success: false, error: 'タスクのクリアに失敗しました' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/timeline/clear-all', async (req, res) => {
        try {
            const success = await taskManager.clearAllTimelineData(req.userId);
            if (success) {
                res.json({ success: true, message: 'すべてのタイムラインデータを削除しました' });
            } else {
                res.status(500).json({ success: false, error: 'タイムラインデータの削除に失敗しました' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 履歴関連のAPIエンドポイント
    app.get('/api/history/dates', async (req, res) => {
        try {
            console.log('履歴日付一覧取得リクエストを受信');
            const result = await taskManager.getAllHistoryDates(req.userId);
            res.json(result);
        } catch (error) {
            console.error('履歴日付取得エラー:', error);
            res.status(500).json({ success: false, message: '履歴日付の取得に失敗しました' });
        }
    });

    app.get('/api/history/:date', async (req, res) => {
        try {
            const dateString = req.params.date;
            console.log(`履歴取得リクエストを受信: ${dateString}`);
            const result = await taskManager.loadHistoryByDate(dateString, req.userId);
            
            if (result.success) {
                res.json(result);
            } else {
                res.status(404).json(result);
            }
        } catch (error) {
            console.error('履歴取得エラー:', error);
            res.status(500).json({ success: false, message: '履歴の取得に失敗しました' });
        }
    });

    app.post('/api/history/:date', async (req, res) => {
        try {
            const dateString = req.params.date;
            const data = req.body;
            console.log(`履歴更新リクエストを受信: ${dateString}`);
            
            const result = await taskManager.updateHistoryByDate(dateString, data, req.userId);
            
            if (result.success) {
                res.json(result);
            } else {
                res.status(500).json(result);
            }
        } catch (error) {
            console.error('履歴更新エラー:', error);
            res.status(500).json({ success: false, message: '履歴の更新に失敗しました' });
        }
    });

    app.post('/api/history/:date/create', async (req, res) => {
        try {
            const dateString = req.params.date;
            console.log(`新しい履歴作成リクエストを受信: ${dateString}`);
            
            const result = await taskManager.createNewHistoryForDate(dateString, req.userId);
            
            if (result.success) {
                res.json(result);
            } else {
                res.status(400).json(result);
            }
        } catch (error) {
            console.error('履歴作成エラー:', error);
            res.status(500).json({ success: false, message: '履歴の作成に失敗しました' });
        }
    });

    app.post('/api/history/:date/tasks', async (req, res) => {
        try {
            const dateString = req.params.date;
            const taskData = req.body;
            console.log(`履歴タスク追加リクエストを受信: ${dateString}`, taskData);
            
            // 日付形式の検証
            if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
                console.error('無効な日付形式:', dateString);
                return res.status(400).json({ 
                    success: false, 
                    message: '無効な日付形式です。YYYY-MM-DD形式で指定してください。' 
                });
            }
            
            const result = await taskManager.addTaskToHistory(dateString, taskData, req.userId);
            
            if (result.success) {
                res.json(result);
            } else {
                console.error('履歴タスク追加失敗:', result);
                res.status(400).json(result);
            }
        } catch (error) {
            console.error('履歴タスク追加エラー:', error);
            res.status(500).json({ success: false, message: '履歴タスクの追加に失敗しました', error: error.message });
        }
    });

    app.put('/api/history/:date/tasks/:taskId', async (req, res) => {
        try {
            const dateString = req.params.date;
            const taskId = req.params.taskId; // 文字列IDも受け入れる
            const data = req.body;
            const taskName = (data.name || '').trim();
            const startTime = (data.startTime || '').trim();
            const endTime = (data.endTime || '').trim();
            const tag = data.tag || null;
            const memo = typeof data.memo === 'string' ? data.memo : undefined;
            
            console.log(`履歴タスク更新リクエストを受信: ${dateString}, taskId: ${taskId}`, data);
            
            // 日付形式の検証
            if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
                console.error('無効な日付形式:', dateString);
                return res.status(400).json({ 
                    success: false, 
                    message: '無効な日付形式です。YYYY-MM-DD形式で指定してください。' 
                });
            }
            
            if (!taskName || !startTime) {
                return res.status(400).json({ success: false, error: 'タスク名と開始時刻は必須です' });
            }
            
            const url = typeof req.body?.url === 'string' ? req.body.url : undefined;
            const result = await taskManager.updateHistoryTask(dateString, taskId, taskName, startTime, endTime, tag, memo, url, req.userId);
            if (result.success) {
                res.json(result);
            } else {
                res.status(400).json(result);
            }
        } catch (error) {
            console.error('履歴タスク更新エラー:', error);
            res.status(500).json({ success: false, message: '履歴タスクの更新に失敗しました', error: error.message });
        }
    });

    app.put('/api/tasks/:taskId', async (req, res) => {
        try {
            const taskId = req.params.taskId; // Keep as string
            const data = req.body;
            const taskName = (data.name || '').trim();
            const startTime = (data.startTime || '').trim();
            const endTime = (data.endTime || '').trim();
            const tag = data.tag || null;
            const memo = typeof data.memo === 'string' ? data.memo : undefined;
            
            if (!taskName || !startTime) {
                return res.status(400).json({ success: false, error: 'タスク名と開始時刻は必須です' });
            }
            
            const url = typeof req.body?.url === 'string' ? req.body.url : undefined;
            const result = await taskManager.updateTask(taskId, taskName, startTime, endTime, tag, memo, url, req.userId);
            if (result) {
                const responseData = { success: true, task: result.task };
                if (result.adjustments) {
                    responseData.adjustments = result.adjustments;
                }
                res.json(responseData);
            } else {
                res.status(404).json({ success: false, error: 'タスクが見つかりません' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.delete('/api/tasks/:taskId', async (req, res) => {
        try {
            const taskId = req.params.taskId; // 文字列IDも受け入れる
            console.log(`タスク削除リクエスト - ID: ${taskId} (${typeof taskId})`);
            const deletedTask = await taskManager.deleteTask(taskId, req.userId);
            if (deletedTask) {
                console.log(`タスク削除成功: ${JSON.stringify(deletedTask)}`);
                res.json({ success: true, task: deletedTask });
            } else {
                console.log(`タスクが見つかりません - ID: ${taskId}`);
                res.status(404).json({ success: false, error: 'タスクが見つかりません' });
            }
        } catch (error) {
            console.error(`タスク削除エラー: ${error}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // 履歴タスク削除のAPIエンドポイント
    app.delete('/api/history/:date/tasks/:taskId', async (req, res) => {
        try {
            const dateString = req.params.date;
            const taskId = req.params.taskId;
            console.log(`履歴タスク削除リクエスト - Date: ${dateString}, ID: ${taskId}`);
            
            const result = await taskManager.deleteHistoryTask(dateString, taskId, req.userId);
            if (result.success) {
                console.log(`履歴タスク削除成功: ${JSON.stringify(result.task)}`);
                res.json(result);
            } else {
                console.log(`履歴タスクが見つかりません - Date: ${dateString}, ID: ${taskId}`);
                res.status(404).json(result);
            }
        } catch (error) {
            console.error(`履歴タスク削除エラー: ${error}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/report', async (req, res) => {
        try {
            const content = await taskManager.loadReport(req.userId);
            res.json({ success: true, content: content });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/report', async (req, res) => {
        try {
            const data = req.body;
            const content = data.content || '';
            
            const success = await taskManager.saveReport(content, req.userId);
            if (success) {
                res.json({ success: true, message: '報告書を保存しました' });
            } else {
                res.status(500).json({ success: false, error: '報告書の保存に失敗しました' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/report-urls', async (req, res) => {
        try {
            const urls = await taskManager.loadReportUrls(req.userId);
            res.json({ success: true, urls: urls });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/report-urls', async (req, res) => {
        try {
            const data = req.body;
            const name = (data.name || '').trim();
            const url = (data.url || '').trim();
            
            if (!name || !url) {
                return res.status(400).json({ success: false, error: '名前とURLは必須です' });
            }
            
            const newUrl = await taskManager.addReportUrl(name, url, req.userId);
            if (newUrl) {
                res.json({ success: true, url: newUrl });
            } else {
                res.status(500).json({ success: false, error: 'URLの追加に失敗しました' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.delete('/api/report-urls/:urlId', async (req, res) => {
        try {
            const urlId = parseInt(req.params.urlId);
            const deletedUrl = await taskManager.deleteReportUrl(urlId, req.userId);
            if (deletedUrl) {
                res.json({ success: true, url: deletedUrl });
            } else {
                res.status(404).json({ success: false, error: 'URLが見つかりません' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/report-tabs', async (req, res) => {
        try {
            // データ移行を確認
            await taskManager.migrateLegacyReportData?.(req.userId);
            
            const tabData = await taskManager.loadReportTabs(req.userId);
            res.json({ success: true, tabs: tabData });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/report-tabs/:tabId', async (req, res) => {
        try {
            const tabId = req.params.tabId;
            const content = await taskManager.getReportTabContent(tabId, req.userId);
            res.json({ success: true, content: content });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/report-tabs/:tabId', async (req, res) => {
        try {
            const tabId = req.params.tabId;
            const data = req.body;
            const content = data.content || '';
            
            const success = await taskManager.saveReportTabContent(tabId, content, req.userId);
            if (success) {
                res.json({ success: true, message: '報告内容を保存しました' });
            } else {
                res.status(500).json({ success: false, error: '報告内容の保存に失敗しました' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/open-url', async (req, res) => {
        try {
            const { url } = req.body;
            if (url) {
                const { spawn } = require('child_process');
                const os = require('os');
                const platform = os.platform();
                
                // Webアプリ前提: Electronのウィンドウ位置連携は行わない
                const windowArgs = [];
                
                let command;
                let args;
                
                if (platform === 'win32') {
                    // Windowsでは複数のChromeパスを試行
                    const chromePaths = [
                        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                        process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
                    ];
                    
                    let chromeFound = false;
                    const fs = require('fs');
                    
                    for (const chromePath of chromePaths) {
                        try {
                            if (fs.existsSync(chromePath)) {
                                const os = require('os');
                                const path = require('path');
                                const userDataDir = path.join(os.homedir(), '.nippo-chrome-profile');
                                
                                // ディレクトリが存在しない場合は作成
                                if (!fs.existsSync(userDataDir)) {
                                    fs.mkdirSync(userDataDir, { recursive: true });
                                }
                                
                                const chromeArgs = [
                                    '--new-window',
                                    '--no-default-browser-check',
                                    '--no-first-run',
                                    '--disable-default-apps',
                                    `--user-data-dir=${userDataDir}`
                                ];
                                chromeArgs.push(...windowArgs);
                                chromeArgs.push(url);
                                
                                spawn(chromePath, chromeArgs, { detached: true, stdio: 'ignore' });
                                chromeFound = true;
                                break;
                            }
                        } catch (error) {
                            continue;
                        }
                    }
                    
                    if (!chromeFound) {
                        // デフォルトブラウザで開く
                        spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
                    }
                } else if (platform === 'darwin') {
                    // Macでは新規ウィンドウでブラウザを開く
                    try {
                        const os = require('os');
                        const path = require('path');
                        const userDataDir = path.join(os.homedir(), '.nippo-chrome-profile');
                        
                        // ディレクトリが存在しない場合は作成
                        if (!fs.existsSync(userDataDir)) {
                            fs.mkdirSync(userDataDir, { recursive: true });
                        }
                        
                        const chromeArgs = [
                            '--new-window',
                            '--no-default-browser-check',
                            '--no-first-run',
                            '--disable-default-apps',
                            `--user-data-dir=${userDataDir}`
                        ];
                        chromeArgs.push(...windowArgs);
                        chromeArgs.push(url);
                        
                        spawn('open', ['-n', '-a', 'Google Chrome', '--args', ...chromeArgs], { detached: true, stdio: 'ignore' });
                    } catch (error) {
                        // フォールバック
                        spawn('open', [url], { detached: true, stdio: 'ignore' });
                    }
                } else {
                    // Linux用（ChromeまたはFirefoxで新規ウィンドウ）
                    try {
                        const os = require('os');
                        const path = require('path');
                        const userDataDir = path.join(os.homedir(), '.nippo-chrome-profile');
                        
                        // ディレクトリが存在しない場合は作成
                        if (!fs.existsSync(userDataDir)) {
                            fs.mkdirSync(userDataDir, { recursive: true });
                        }
                        
                        const chromeArgs = [
                            '--new-window',
                            '--no-default-browser-check',
                            '--no-first-run',
                            '--disable-default-apps',
                            `--user-data-dir=${userDataDir}`
                        ];
                        chromeArgs.push(...windowArgs);
                        chromeArgs.push(url);
                        
                        spawn('google-chrome', chromeArgs, { detached: true, stdio: 'ignore' });
                    } catch (error) {
                        try {
                            const firefoxArgs = ['-new-window'];
                            if (windowArgs.length > 0) {
                                // Firefoxでは位置指定が異なる
                                firefoxArgs.push(`-width=1200`, `-height=800`);
                            }
                            firefoxArgs.push(url);
                            spawn('firefox', firefoxArgs, { detached: true, stdio: 'ignore' });
                        } catch (error) {
                            spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
                        }
                    }
                }
                
                res.json({ success: true });
            } else {
                res.status(400).json({ success: false, error: 'URL is required' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Goal stock API endpoints
    app.get('/api/goals', async (req, res) => {
        try {
            const goals = await taskManager.loadGoalStock(req.userId);
            res.json({ success: true, goals: goals });
        } catch (error) {
            console.error('Goal stock load error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/goals', async (req, res) => {
        try {
            const { goals } = req.body;
            await taskManager.saveGoalStock(goals, req.userId);
            res.json({ success: true, message: 'Goal stock saved successfully' });
        } catch (error) {
            console.error('Goal stock save error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Task stock API endpoints
    app.get('/api/task-stock', async (req, res) => {
        try {
            const tasks = await taskManager.loadTaskStock(req.userId);
            res.json({ success: true, tasks: tasks });
        } catch (error) {
            console.error('Task stock load error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/task-stock', async (req, res) => {
        try {
            const { tasks } = req.body;
            await taskManager.saveTaskStock(tasks, req.userId);
            res.json({ success: true, message: 'Task stock saved successfully' });
        } catch (error) {
            console.error('Task stock save error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Tag stock API endpoints
    app.get('/api/tags', async (req, res) => {
        try {
            const tags = await taskManager.loadTagStock(req.userId);
            res.json({ success: true, tags: tags });
        } catch (error) {
            console.error('Tag stock load error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/tags', async (req, res) => {
        try {
            const { tags } = req.body;
            await taskManager.saveTagStock(tags, req.userId);
            res.json({ success: true, message: 'Tag stock saved successfully' });
        } catch (error) {
            console.error('Tag stock save error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/health', (req, res) => {
        res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });

    // 履歴データクリーンアップ API
    app.post('/api/history/cleanup', async (req, res) => {
        try {
            const { targetDate } = req.body;
            const result = await taskManager.cleanupHistoryByDate(targetDate, req.userId);
            res.json(result);
        } catch (error) {
            console.error('履歴クリーンアップエラー:', error);
            res.status(500).json({ success: false, message: '履歴クリーンアップに失敗しました' });
        }
    });

    function hasDocStore(tm) {
        return tm && typeof tm._getDoc === 'function' && typeof tm._setDoc === 'function';
    }

    function encryptStringAesGcmNode(plaintext, secret) {
        const key = crypto.createHash('sha256').update(String(secret)).digest();
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        const combined = Buffer.concat([ciphertext, tag]);
        return { iv: iv.toString('base64'), ciphertext: combined.toString('base64') };
    }

    function decryptStringAesGcmNode(ivB64, cipherB64, secret) {
        const key = crypto.createHash('sha256').update(String(secret)).digest();
        const iv = Buffer.from(String(ivB64 || ''), 'base64');
        const combined = Buffer.from(String(cipherB64 || ''), 'base64');
        if (combined.length < 16) throw new Error('ciphertext is too short');
        const tag = combined.subarray(combined.length - 16);
        const ciphertext = combined.subarray(0, combined.length - 16);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return plain.toString('utf8');
    }

    async function callOpenAiChatNode({ apiKey, messages, temperature = 0.3, maxTokens = 800 }) {
        if (typeof fetch !== 'function') throw new Error('fetch is not available in this Node runtime');
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'gpt-5.2',
                messages,
                temperature,
                max_completion_tokens: maxTokens,
            })
        });
        const data = await r.json().catch(() => null);
        if (!r.ok) {
            const msg = data?.error?.message || data?.error || 'OpenAI API error';
            throw new Error(msg);
        }
        return String(data?.choices?.[0]?.message?.content || '');
    }

    // GPT API key (encrypted, stored in nippo_docs)
    app.get('/api/gpt-api-key', async (req, res) => {
        try {
            if (!hasDocStore(taskManager)) {
                return res.status(501).json({ success: false, error: 'gpt-api-key is not supported' });
            }
            const doc = await taskManager._getDoc(req.userId, 'gpt_api_key', 'default', null);
            const hasKey = !!(doc && typeof doc === 'object' && doc.iv && doc.ciphertext);
            const encryptionReady = !!process.env.GPT_API_KEY_ENCRYPTION_SECRET;
            res.json({ success: true, hasKey, encryptionReady });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/gpt-api-key', async (req, res) => {
        try {
            if (!hasDocStore(taskManager)) {
                return res.status(501).json({ success: false, error: 'gpt-api-key is not supported' });
            }
            const apiKey = String(req.body?.apiKey || '').trim();
            if (!apiKey) return res.status(400).json({ success: false, error: 'APIキーが必要です' });

            const secret = process.env.GPT_API_KEY_ENCRYPTION_SECRET;
            if (!secret) return res.status(500).json({ success: false, error: 'Missing env var: GPT_API_KEY_ENCRYPTION_SECRET' });

            const encrypted = encryptStringAesGcmNode(apiKey, secret);
            await taskManager._setDoc(req.userId, 'gpt_api_key', 'default', { ...encrypted, updatedAt: new Date().toISOString() });
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/gpt/report-from-timeline', async (req, res) => {
        try {
            if (!hasDocStore(taskManager)) {
                return res.status(501).json({ success: false, error: 'gpt is not supported' });
            }
            const secret = process.env.GPT_API_KEY_ENCRYPTION_SECRET;
            if (!secret) return res.status(500).json({ success: false, error: 'Missing env var: GPT_API_KEY_ENCRYPTION_SECRET' });

            const doc = await taskManager._getDoc(req.userId, 'gpt_api_key', 'default', null);
            if (!doc?.iv || !doc?.ciphertext) return res.status(400).json({ success: false, error: 'GPT APIキーが未設定です（設定から登録してください）' });
            const apiKey = decryptStringAesGcmNode(doc.iv, doc.ciphertext, secret);
            if (!apiKey) return res.status(500).json({ success: false, error: 'GPT APIキーの復号に失敗しました' });

            const tasks = Array.isArray(req.body?.tasks) ? req.body.tasks : [];
            const normalized = tasks
                .map((t) => ({
                    name: String(t?.name || '').slice(0, 200),
                    memo: String(t?.memo || '').slice(0, 1400),
                    dateString: typeof t?.dateString === 'string' ? String(t.dateString).slice(0, 32) : '',
                }))
                .filter((t) => String(t.memo || '').trim() !== '');

            // Group same-name tasks across days to reduce redundancy (no UI, automatic).
            const grouped = new Map();
            for (let i = 0; i < normalized.length; i += 1) {
                const t = normalized[i];
                const title = String(t?.name || '').trim();
                const memo = String(t?.memo || '').trim();
                if (!memo) continue;
                const key = title ? `t:${title}` : `u:${i}`;
                const cur = grouped.get(key) || { name: title, memos: [] };
                cur.memos.push({ dateString: String(t?.dateString || ''), memo });
                grouped.set(key, cur);
            }

            const merged = [];
            for (const v of grouped.values()) {
                const memos = Array.isArray(v?.memos) ? v.memos : [];
                // Keep chronological order in the merged memo (old -> new).
                memos.sort((a, b) => String(a?.dateString || '').localeCompare(String(b?.dateString || '')));
                const mergedMemo = memos
                    .map((m) => String(m?.memo || '').trim())
                    .filter(Boolean)
                    .join('\n');
                if (!mergedMemo) continue;
                merged.push({ name: String(v?.name || '').slice(0, 200), memo: mergedMemo.slice(0, 4000) });
            }

            const limited = merged.slice(0, 80);
            if (limited.length === 0) return res.status(400).json({ success: false, error: 'メモがあるタスクがありません' });

            const splitMemoToPieces = (input) => {
                const memo = String(input || '')
                    .replace(/\r\n?/g, '\n')
                    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
                    .trim();
                if (!memo) return [];

                const lines = memo
                    .split('\n')
                    .map((s) => String(s || '').trim())
                    .filter(Boolean);

                if (lines.length >= 2) return lines;
                if (memo.length <= 220) return [memo];

                const pieces = [];
                let buf = '';
                for (const ch of memo) {
                    buf += ch;
                    if (ch === '。' || ch === '！' || ch === '？' || ch === '!' || ch === '?' || buf.length >= 120) {
                        const t = buf.trim();
                        if (t) pieces.push(t);
                        buf = '';
                    }
                }
                const tail = buf.trim();
                if (tail) pieces.push(tail);
                return pieces.length ? pieces : [memo];
            };

            const dedupePieces = (pieces) => {
                const seen = new Set();
                const out = [];
                for (const raw of pieces) {
                    const line = String(raw || '').trim();
                    if (!line) continue;
                    const norm = line
                        .replace(/^[\-\*・●◯]+\s*/g, '')
                        .replace(/[\s\u3000\t]+/g, ' ')
                        .replace(/[。．\.]+$/g, '')
                        .toLowerCase();
                    if (!norm) continue;
                    if (seen.has(norm)) continue;
                    seen.add(norm);
                    out.push(line);
                }
                return out;
            };

            const scoreMemoPiece = (piece) => {
                const s = String(piece || '').trim();
                if (!s) return -999;
                const lowSignal = /(調査中|確認中|対応中|作業中|進行中|継続|続き|WIP|wip|いったん|一旦|ひとまず|様子見|試行|試す|検討中)/;
                const resultSignal = /(完了|修正|改善|解消|復旧|反映|追加|更新|削除|統合|作成|実装|リリース|公開|原因|特定|再現|回避|方針|決定|合意|対応済|できた|OK|クローズ)/;
                const problemSignal = /(不具合|エラー|失敗|原因|問題|課題|ボトルネック|遅い|重い|詰まり|ブロック|障害)/;

                let score = 0;
                const len = s.length;
                if (len >= 12 && len <= 140) score += 2;
                else if (len > 140) score += 1;
                else score -= 1;

                if (resultSignal.test(s)) score += 4;
                if (problemSignal.test(s)) score += 2;
                if (lowSignal.test(s) && !resultSignal.test(s)) score -= 3;
                if (/^(確認|調査|対応|作業|実装|修正|変更)(中|予定|します|した)?[。\.]*$/.test(s)) score -= 4;
                return score;
            };

            const pickKeyPieces = (pieces, maxPieces) => {
                const list = dedupePieces(pieces);
                if (list.length <= maxPieces) return list;

                // Recency bias: earlier pieces are treated as more recent because callers
                // merge memo blocks in descending date order (newest first).
                const recencyBonusMax = 1.2;
                const denom = Math.max(1, list.length - 1);

                const scored = list
                    .map((text, idx) => {
                        const base = scoreMemoPiece(text);
                        const recencyBonus = ((denom - idx) / denom) * recencyBonusMax;
                        return { idx, text, score: base + recencyBonus };
                    })
                    .sort((a, b) => (b.score - a.score) || (a.idx - b.idx));

                const picked = scored.slice(0, Math.max(1, maxPieces)).sort((a, b) => a.idx - b.idx);
                return picked.map((p) => p.text);
            };

            const decideKeyPieceBudget = (totalMemoChars, totalPieces) => {
                if (totalMemoChars >= 12000 || totalPieces >= 180) return 1;
                if (totalMemoChars >= 7000 || totalPieces >= 110) return 2;
                if (totalMemoChars >= 3500 || totalPieces >= 60) return 3;
                return 4;
            };

            let totalMemoChars = 0;
            let totalPieces = 0;
            for (const t of limited) {
                totalMemoChars += String(t.memo || '').length;
                totalPieces += splitMemoToPieces(t.memo).length;
            }
            const budget = decideKeyPieceBudget(totalMemoChars, totalPieces);

            const timeline = limited
                .map((t) => {
                    const title = String(t.name || '').trim();
                    const memo = String(t.memo || '').trim();
                    if (!memo) return '';

                    // Prefer newer side for picking, but keep chronological order in display.
                    const piecesChrono = splitMemoToPieces(memo);
                    const piecesForPick = piecesChrono.slice().reverse();
                    const pickedNewerFirst = pickKeyPieces(piecesForPick, budget);
                    const picked = pickedNewerFirst.slice().reverse();
                    const compact = picked
                        .map((s) => String(s || '').trim())
                        .filter(Boolean)
                        .map((s) => (s.length > 220 ? s.slice(0, 220) + '…' : s))
                        .join('\n');

                    const body = compact || memo;
                    if (!title) return `【メモ】\n${body}`;
                    return `【${title}】\n${body}`;
                })
                .filter(Boolean)
                .join('\n\n');

            const messages = [
                { role: 'system', content: 'あなたは日本語の業務日報を作成するアシスタントです。入力(作業タイトル/メモ)のみを根拠に、社内向けの丁寧で簡潔な報告文を作成してください。誇張せず、事実ベースでまとめます。硬い言い回しは避け、です/ます調は維持しつつ、できるだけ平易でわかりやすい言葉を使います。' },
                { role: 'user', content: '次の入力から「報告内容」を作ってください。\n\n要件:\n- 日本語\n- 丁寧な文体(です/ます)\n- 文章は硬くしすぎない（自然でわかりやすい言葉を使う）\n- 難しい言い回し・過度にビジネスっぽい敬語・抽象語（例: 〜いたしました/〜させていただきました/推進/実施/対応 等）の多用は避ける\n- 箇条書きは使わず、読みやすい文章\n- 空行は入れない（連続改行は禁止）\n- 改行する場合は段落区切りのみ。段落間も改行1つだけ（文の途中で不自然に改行しない）\n- 全体は2〜4つのまとまりになるように（必要なら分ける）\n- 作業時間・工数・時間帯など時間情報には一切触れない（推測もしない）\n- 対象期間・日付・複数日にわたる継続など、期間に関する言及は一切しない（推測もしない）\n- 入力に無い事実は追加しない\n- メモがあれば自然に文章へ反映する\n- 似た内容や同一趣旨の作業は、言い換えて繰り返さず可能な限り統合して一度だけ述べる（冗長な重複を避ける）\n- 入力の情報量が多い場合、途中経過（調査中/確認中/対応中など）は省略し、完了・変更点・決定事項・課題の解消など「結果」を優先する\n- 入力の情報量が少ない場合は、途中経過も最大1点まで自然に拾ってよい\n- 専門用語は可能な範囲でわかりやすい言葉に置き換える（ただし解説は不要で、文章を長くしない）\n\n入力（作業タイトル/メモ）:\n' + timeline }
            ];

            const textRaw = await callOpenAiChatNode({ apiKey, messages, temperature: 0.1, maxTokens: 900 });
            const text = String(textRaw || '')
                .replace(/\r\n?/g, '\n')
                .replace(/\n{2,}/g, '\n')
                .trim();
            res.json({ success: true, text });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Web版用: 設定API（Electron版はIPCで扱うが、WebではこのAPIを使う）
    app.get('/api/settings', async (req, res) => {
        try {
            if (typeof taskManager.loadSettings !== 'function') {
                return res.json({ success: true, settings: {} });
            }
            const settings = await taskManager.loadSettings(req.userId);
            // 可能なら、サーバ側の「開始/終了時刻生成」にも反映（ファイル版TaskManager向け）
            if (typeof taskManager.setTimeRoundingConfig === 'function') {
                taskManager.setTimeRoundingConfig(settings?.timeRounding);
            }
            res.json({ success: true, settings });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/settings', async (req, res) => {
        try {
            if (typeof taskManager.saveSettings !== 'function') {
                return res.status(501).json({ success: false, error: 'settings API is not supported' });
            }
            const settings = req.body.settings;
            const ok = await taskManager.saveSettings(settings, req.userId);
            if (ok && typeof taskManager.setTimeRoundingConfig === 'function') {
                taskManager.setTimeRoundingConfig(settings?.timeRounding);
            }
            res.json({ success: !!ok });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    return { app, taskManager };
}

module.exports = { TaskManager, createApp };