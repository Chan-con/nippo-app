from flask import Flask, jsonify, request
from flask_cors import CORS
import datetime
import os
import json
import pyperclip
from pathlib import Path

app = Flask(__name__)
CORS(app)

# データディレクトリの設定
DATA_DIR = Path(__file__).parent.parent / "datas"
DATA_DIR.mkdir(exist_ok=True)

class TaskManager:
    def __init__(self):
        self.data_file = DATA_DIR / "data.txt"
        self.task_list_file = DATA_DIR / "task_list.txt"
        self.report_file = DATA_DIR / "report.txt"
        self.report_tabs_file = DATA_DIR / "report_tabs.json"
        self.urls_file = DATA_DIR / "report_urls.json"
    
    def get_time(self):
        """現在の時間を取得して12時間表示に変換"""
        now = datetime.datetime.now()
        am_or_pm = "午前" if now.hour < 12 else "午後"
        
        # 11時の50分以降は次の時間にする
        if now.hour == 11 and 50 <= now.minute <= 59:
            now = now + datetime.timedelta(minutes=10)
            now = now.replace(minute=0)
        
        # 12時間形式に変換（先頭0を削除）
        hour_12 = now.hour % 12
        if hour_12 == 0:
            hour_12 = 12
        
        minute = now.minute
        return f"{am_or_pm} {hour_12}:{minute:02d}"
    
    def load_schedule(self):
        """スケジュールデータを読み込む"""
        tasks = []
        print(f"データファイルのパス: {self.data_file}")
        print(f"データファイルの存在: {self.data_file.exists()}")
        
        try:
            if self.data_file.exists():
                with open(self.data_file, 'r', encoding='utf-8') as f:
                    lines = f.readlines()
                
                print(f"読み込んだ行数: {len(lines)}")
                if lines:
                    print("ファイル内容:")
                    for i, line in enumerate(lines):
                        try:
                            print(f"  {i+1}: {repr(line)}")
                        except UnicodeEncodeError:
                            print(f"  {i+1}: [絵文字を含む行]")
                
                task_data = []
                for line in lines:
                    line = line.strip()
                    if "~" in line:
                        # 時間範囲の行
                        try:
                            start_time, end_time = line.split("~", 1)
                            task_data.extend([start_time.strip(), end_time.strip()])
                        except Exception as e:
                            print(f"時間行の解析エラー: {line}, エラー: {e}")
                            continue
                    else:
                        # タスク名の行
                        if line:
                            task_data.append(line)
                            if len(task_data) >= 3:
                                try:
                                    # 終了時刻の処理：空文字列、"None"、"none"をNoneとして扱う
                                    end_time = task_data[1].strip() if len(task_data) > 1 and task_data[1] else ""
                                    if end_time.lower() in ["", "none"] or end_time == "None":
                                        end_time = None
                                    
                                    # タスク名を処理
                                    task_name = task_data[2] if len(task_data) > 2 else ""
                                    is_break = False
                                    
                                    # 休憩タスクの判定と名前の正規化
                                    if task_name.startswith('[BREAK]'):
                                        is_break = True
                                        task_name = task_name.replace('[BREAK]', '').strip()
                                    elif task_name.startswith('🔴 休憩:'):
                                        is_break = True
                                        task_name = task_name.replace('🔴 休憩:', '').strip()
                                    elif task_name.startswith('🔴 休憩'):
                                        is_break = True
                                        task_name = task_name.replace('🔴 休憩', '').strip()
                                    elif task_name == '休憩':
                                        is_break = True
                                    
                                    # 空の場合は休憩として設定
                                    if not task_name and is_break:
                                        task_name = '休憩'
                                    
                                    task = {
                                        'id': len(tasks),
                                        'startTime': task_data[0] if len(task_data) > 0 else "",
                                        'endTime': end_time,
                                        'name': task_name,
                                        'isBreak': is_break
                                    }
                                    tasks.append(task)
                                    try:
                                        print(f"パースしたタスク: {task}")
                                    except UnicodeEncodeError:
                                        print(f"パースしたタスク: [絵文字を含むタスク] ID={task['id']}")
                                    task_data = []
                                except Exception as e:
                                    print(f"タスクデータの解析エラー: {task_data}, エラー: {e}")
                                    task_data = []
                                    continue
            else:
                print("データファイルが存在しません")
            
            print(f"読み込み完了 - タスク数: {len(tasks)}")
            return tasks
        except Exception as e:
            print(f"load_schedule全体のエラー: {e}")
            import traceback
            traceback.print_exc()
            return []
    
    def save_schedule(self, tasks):
        """スケジュールデータを保存"""
        try:
            with open(self.data_file, 'w', encoding='utf-8') as f:
                for task in tasks:
                    start_time = task.get('startTime', '')
                    end_time = task.get('endTime')
                    if end_time is None:
                        end_time = ''
                    name = task.get('name', '')
                    # 休憩タスクの場合は識別子を追加
                    if task.get('isBreak', False):
                        if name == '休憩' or name == '':
                            name = "[BREAK] 休憩"
                        else:
                            name = f"[BREAK] {name}"
                    f.write(f"{start_time} ~ {end_time}\n{name}\n")
            print(f"スケジュール保存完了: {len(tasks)}件")
        except Exception as e:
            print(f"save_scheduleエラー: {e}")
            import traceback
            traceback.print_exc()
    
    def add_task(self, task_name, is_break=False):
        """タスクを追加"""
        try:
            print(f"add_task開始: name='{task_name}', isBreak={is_break}")
            tasks = self.load_schedule()
            add_time = self.get_time()
            print(f"現在時刻: {add_time}")
            
            # 未終了のタスクがあれば終了時刻を設定
            for task in tasks:
                if not task.get('endTime'):
                    try:
                        print(f"未終了タスクを終了: {task}")
                    except UnicodeEncodeError:
                        print(f"未終了タスクを終了: [絵文字を含むタスク] ID={task.get('id')}")
                    task['endTime'] = add_time
            
            # 新しいタスクを追加
            new_task = {
                'id': len(tasks),
                'startTime': add_time,
                'endTime': None,
                'name': task_name,
                'isBreak': is_break
            }
            tasks.append(new_task)
            try:
                print(f"新しいタスクを追加: {new_task}")
            except UnicodeEncodeError:
                print(f"新しいタスクを追加: [絵文字を含むタスク] ID={new_task['id']}")
            
            self.save_schedule(tasks)
            print("add_task完了")
            return new_task
        except Exception as e:
            print(f"add_taskエラー: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def end_current_task(self):
        """現在のタスクを終了"""
        tasks = self.load_schedule()
        add_time = self.get_time()
        
        print(f"終了処理開始 - 現在時刻: {add_time}")
        print(f"読み込んだタスク数: {len(tasks)}")
        
        # 未終了のタスクを探して終了時刻を設定
        for i, task in enumerate(tasks):
            print(f"タスク{i}: {task}")
            if not task.get('endTime'):
                print(f"未終了タスクを発見: {task['name']}")
                task['endTime'] = add_time
                self.save_schedule(tasks)
                print(f"タスクを終了しました: {task}")
                return task
        
        print("未終了のタスクが見つかりませんでした")
        return None
    
    def get_timeline_text(self):
        """タイムラインのテキストを取得"""
        if not self.data_file.exists():
            return ""
        
        with open(self.data_file, 'r', encoding='utf-8') as f:
            return f.read()
    
    def clear_all_tasks(self):
        """すべてのタスクをクリア"""
        try:
            if self.data_file.exists():
                self.data_file.unlink()  # ファイルを削除
            return True
        except Exception as e:
            print(f"タスククリアエラー: {e}")
            return False
    
    def parse_time_to_minutes(self, time_str):
        """時間文字列を分に変換（比較用）"""
        try:
            if not time_str:
                return None
            
            # "午前 10:30" -> 分に変換
            is_am = time_str.includes('午前') if hasattr(time_str, 'includes') else '午前' in time_str
            time_only = time_str.replace('午前 ', '').replace('午後 ', '').strip()
            
            if ':' not in time_only:
                return None
                
            hours, minutes = time_only.split(':')
            hour = int(hours)
            minute = int(minutes)
            
            # 12時間形式を24時間形式に変換
            if not is_am and hour != 12:
                hour += 12
            elif is_am and hour == 12:
                hour = 0
                
            return hour * 60 + minute
        except:
            return None
    
    def minutes_to_time_str(self, minutes):
        """分を時間文字列に変換"""
        try:
            if minutes is None:
                return ""
            
            hour = minutes // 60
            minute = minutes % 60
            
            # 24時間形式を12時間形式に変換
            if hour == 0:
                return f"午前 12:{minute:02d}"
            elif hour < 12:
                return f"午前 {hour}:{minute:02d}"
            elif hour == 12:
                return f"午後 12:{minute:02d}"
            else:
                return f"午後 {hour - 12}:{minute:02d}"
        except:
            return ""
    
    def adjust_conflicting_tasks(self, tasks, edited_task_id, new_start_time, new_end_time):
        """時間矛盾を解決するためにタスクを調整"""
        adjustments = []
        
        if edited_task_id < 0 or edited_task_id >= len(tasks):
            return tasks, adjustments
        
        new_start_minutes = self.parse_time_to_minutes(new_start_time)
        new_end_minutes = self.parse_time_to_minutes(new_end_time) if new_end_time else None
        
        if new_start_minutes is None:
            return tasks, adjustments
        
        # 前のタスクとの矛盾をチェック
        if edited_task_id > 0:
            prev_task = tasks[edited_task_id - 1]
            if prev_task.get('endTime'):
                prev_end_minutes = self.parse_time_to_minutes(prev_task['endTime'])
                if prev_end_minutes and prev_end_minutes > new_start_minutes:
                    # 前のタスクの終了時間を調整
                    prev_task['endTime'] = self.minutes_to_time_str(new_start_minutes)
                    adjustments.append({
                        'taskId': edited_task_id - 1,
                        'field': 'endTime',
                        'oldValue': self.minutes_to_time_str(prev_end_minutes),
                        'newValue': prev_task['endTime'],
                        'reason': '次のタスクとの重複を解消'
                    })
        
        # 次のタスクとの矛盾をチェック
        if new_end_minutes and edited_task_id < len(tasks) - 1:
            next_task = tasks[edited_task_id + 1]
            next_start_minutes = self.parse_time_to_minutes(next_task['startTime'])
            if next_start_minutes and next_start_minutes < new_end_minutes:
                # 次のタスクの開始時間を調整
                next_task['startTime'] = self.minutes_to_time_str(new_end_minutes)
                adjustments.append({
                    'taskId': edited_task_id + 1,
                    'field': 'startTime',
                    'oldValue': self.minutes_to_time_str(next_start_minutes),
                    'newValue': next_task['startTime'],
                    'reason': '前のタスクとの重複を解消'
                })
        
        return tasks, adjustments
    
    def update_task(self, task_id, task_name, start_time, end_time):
        """タスクを更新"""
        try:
            tasks = self.load_schedule()
            if 0 <= task_id < len(tasks):
                # 既存の休憩フラグを保持
                is_break = tasks[task_id].get('isBreak', False)
                
                # 時間矛盾を調整
                adjusted_tasks, adjustments = self.adjust_conflicting_tasks(
                    tasks, task_id, start_time, end_time
                )
                
                # 編集対象のタスクを更新
                adjusted_tasks[task_id]['name'] = task_name
                adjusted_tasks[task_id]['startTime'] = start_time
                adjusted_tasks[task_id]['endTime'] = end_time if end_time and end_time.strip() else None
                adjusted_tasks[task_id]['isBreak'] = is_break
                
                self.save_schedule(adjusted_tasks)
                
                return {
                    'task': adjusted_tasks[task_id],
                    'adjustments': adjustments
                }
            return None
        except Exception as e:
            print(f"タスク更新エラー: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def delete_task(self, task_id):
        """タスクを削除"""
        try:
            tasks = self.load_schedule()
            if 0 <= task_id < len(tasks):
                deleted_task = tasks.pop(task_id)
                # IDを再振り
                for i, task in enumerate(tasks):
                    task['id'] = i
                self.save_schedule(tasks)
                return deleted_task
            return None
        except Exception as e:
            print(f"タスク削除エラー: {e}")
            return None
    
    def save_report(self, content):
        """報告書を保存"""
        try:
            with open(self.report_file, 'w', encoding='utf-8') as f:
                f.write(content)
            return True
        except Exception as e:
            print(f"報告書保存エラー: {e}")
            return False
    
    def load_report(self):
        """報告書を読み込み"""
        try:
            if self.report_file.exists():
                with open(self.report_file, 'r', encoding='utf-8') as f:
                    return f.read()
            return ""
        except Exception as e:
            print(f"報告書読み込みエラー: {e}")
            return ""
    
    def save_report_urls(self, urls):
        """報告先URLリストを保存"""
        try:
            with open(self.urls_file, 'w', encoding='utf-8') as f:
                json.dump(urls, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            print(f"URL保存エラー: {e}")
            return False
    
    def load_report_urls(self):
        """報告先URLリストを読み込み"""
        try:
            if self.urls_file.exists():
                with open(self.urls_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            return []
        except Exception as e:
            print(f"URL読み込みエラー: {e}")
            return []
    
    def add_report_url(self, name, url):
        """報告先URLを追加"""
        try:
            urls = self.load_report_urls()
            new_url = {
                'id': len(urls),
                'name': name,
                'url': url
            }
            urls.append(new_url)
            if self.save_report_urls(urls):
                return new_url
            return None
        except Exception as e:
            print(f"URL追加エラー: {e}")
            return None
    
    def delete_report_url(self, url_id):
        """報告先URLを削除"""
        try:
            urls = self.load_report_urls()
            if 0 <= url_id < len(urls):
                deleted_url = urls.pop(url_id)
                # IDを再振り
                for i, url in enumerate(urls):
                    url['id'] = i
                if self.save_report_urls(urls):
                    # 関連する報告タブデータも削除
                    self.cleanup_report_tab_data(url_id)
                    return deleted_url
            return None
        except Exception as e:
            print(f"URL削除エラー: {e}")
            return None
    
    def save_report_tabs(self, tab_data):
        """報告先別の報告内容を保存"""
        try:
            with open(self.report_tabs_file, 'w', encoding='utf-8') as f:
                json.dump(tab_data, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            print(f"報告タブデータ保存エラー: {e}")
            return False
    
    def load_report_tabs(self):
        """報告先別の報告内容を読み込み"""
        try:
            if self.report_tabs_file.exists():
                with open(self.report_tabs_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            return {}
        except Exception as e:
            print(f"報告タブデータ読み込みエラー: {e}")
            return {}
    
    def save_report_tab_content(self, url_id, content):
        """特定の報告先の報告内容を保存"""
        try:
            tab_data = self.load_report_tabs()
            tab_data[str(url_id)] = content
            return self.save_report_tabs(tab_data)
        except Exception as e:
            print(f"報告タブ内容保存エラー: {e}")
            return False
    
    def get_report_tab_content(self, url_id):
        """特定の報告先の報告内容を取得"""
        try:
            tab_data = self.load_report_tabs()
            return tab_data.get(str(url_id), '')
        except Exception as e:
            print(f"報告タブ内容取得エラー: {e}")
            return ''
    
    def cleanup_report_tab_data(self, deleted_url_id):
        """削除された報告先の報告データをクリーンアップ"""
        try:
            tab_data = self.load_report_tabs()
            
            # 削除された報告先のデータを削除
            if str(deleted_url_id) in tab_data:
                del tab_data[str(deleted_url_id)]
            
            # IDの再振りに対応してデータを調整
            current_urls = self.load_report_urls()
            new_tab_data = {}
            
            for i, url in enumerate(current_urls):
                old_id = url.get('original_id', i)  # 元のIDを保持していればそれを使用
                if str(old_id) in tab_data:
                    new_tab_data[str(i)] = tab_data[str(old_id)]
                elif str(i) in tab_data:
                    new_tab_data[str(i)] = tab_data[str(i)]
            
            return self.save_report_tabs(new_tab_data)
        except Exception as e:
            print(f"報告タブデータクリーンアップエラー: {e}")
            return False
    
    def migrate_legacy_report_data(self):
        """既存の単一報告書データを新形式に移行"""
        try:
            # 既存のレポートファイルがあるか確認
            if self.report_file.exists() and not self.report_tabs_file.exists():
                legacy_content = self.load_report()
                if legacy_content.strip():
                    # デフォルトタブとして保存
                    tab_data = {'default': legacy_content}
                    if self.save_report_tabs(tab_data):
                        print("既存の報告書データを新形式に移行しました")
                        return True
            return True
        except Exception as e:
            print(f"データ移行エラー: {e}")
            return False

# グローバルなTaskManagerインスタンス
task_manager = TaskManager()

@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    """タスク一覧を取得"""
    try:
        tasks = task_manager.load_schedule()
        print(f"API - 取得したタスク数: {len(tasks)}")
        for task in tasks:
            try:
                print(f"API - タスク: {task}")
            except UnicodeEncodeError:
                print(f"API - タスク: [絵文字を含むタスク] ID={task.get('id')}")
        return jsonify({'success': True, 'tasks': tasks})
    except Exception as e:
        print(f"API - タスク取得エラー: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/tasks', methods=['POST'])
def add_task():
    """タスクを追加"""
    try:
        data = request.get_json()
        task_name = data.get('name', '').strip()
        is_break = data.get('isBreak', False)
        
        print(f"API - タスク追加リクエスト: name='{task_name}', isBreak={is_break}")
        
        if not task_name:
            return jsonify({'success': False, 'error': 'タスク名が必要です'}), 400
        
        new_task = task_manager.add_task(task_name, is_break)
        try:
            print(f"API - 追加されたタスク: {new_task}")
        except UnicodeEncodeError:
            print(f"API - 追加されたタスク: [絵文字を含むタスク] ID={new_task.get('id') if new_task else 'None'}")
        return jsonify({
            'success': True, 
            'task': new_task,
            'taskId': new_task['id']
        })
    except Exception as e:
        print(f"API - タスク追加エラー: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/tasks/end', methods=['POST'])
def end_task():
    """現在のタスクを終了"""
    try:
        ended_task = task_manager.end_current_task()
        if ended_task:
            return jsonify({'success': True, 'task': ended_task})
        else:
            return jsonify({'success': False, 'error': '終了するタスクがありません'}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/timeline/copy', methods=['POST'])
def copy_timeline():
    """タイムラインをクリップボードにコピー"""
    try:
        timeline_text = task_manager.get_timeline_text()
        if timeline_text:
            pyperclip.copy(timeline_text)
            return jsonify({'success': True, 'message': 'タイムラインをコピーしました'})
        else:
            return jsonify({'success': False, 'error': 'コピーするデータがありません'}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/tasks/clear', methods=['POST'])
def clear_all_tasks():
    """すべてのタスクをクリア"""
    try:
        success = task_manager.clear_all_tasks()
        if success:
            return jsonify({'success': True, 'message': 'すべてのタスクをクリアしました'})
        else:
            return jsonify({'success': False, 'error': 'タスクのクリアに失敗しました'}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/tasks/<int:task_id>', methods=['PUT'])
def update_task(task_id):
    """タスクを更新"""
    try:
        data = request.get_json()
        task_name = data.get('name', '').strip()
        start_time = data.get('startTime', '').strip()
        end_time = data.get('endTime', '').strip()
        
        if not task_name or not start_time:
            return jsonify({'success': False, 'error': 'タスク名と開始時刻は必須です'}), 400
        
        result = task_manager.update_task(task_id, task_name, start_time, end_time)
        if result:
            response_data = {'success': True, 'task': result['task']}
            if result.get('adjustments'):
                response_data['adjustments'] = result['adjustments']
            return jsonify(response_data)
        else:
            return jsonify({'success': False, 'error': 'タスクが見つかりません'}), 404
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/tasks/<int:task_id>', methods=['DELETE'])
def delete_task(task_id):
    """タスクを削除"""
    try:
        print(f"タスク削除リクエスト - ID: {task_id}")  # デバッグ用
        deleted_task = task_manager.delete_task(task_id)
        if deleted_task:
            print(f"タスク削除成功: {deleted_task}")
            return jsonify({'success': True, 'task': deleted_task})
        else:
            print(f"タスクが見つかりません - ID: {task_id}")
            return jsonify({'success': False, 'error': 'タスクが見つかりません'}), 404
    except Exception as e:
        print(f"タスク削除エラー: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/report', methods=['GET'])
def get_report():
    """報告書を取得"""
    try:
        content = task_manager.load_report()
        return jsonify({'success': True, 'content': content})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/report', methods=['POST'])
def save_report():
    """報告書を保存"""
    try:
        data = request.get_json()
        content = data.get('content', '')
        
        success = task_manager.save_report(content)
        if success:
            return jsonify({'success': True, 'message': '報告書を保存しました'})
        else:
            return jsonify({'success': False, 'error': '報告書の保存に失敗しました'}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/report-urls', methods=['GET'])
def get_report_urls():
    """報告先URLリストを取得"""
    try:
        urls = task_manager.load_report_urls()
        return jsonify({'success': True, 'urls': urls})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/report-urls', methods=['POST'])
def add_report_url():
    """報告先URLを追加"""
    try:
        data = request.get_json()
        name = data.get('name', '').strip()
        url = data.get('url', '').strip()
        
        if not name or not url:
            return jsonify({'success': False, 'error': '名前とURLは必須です'}), 400
        
        new_url = task_manager.add_report_url(name, url)
        if new_url:
            return jsonify({'success': True, 'url': new_url})
        else:
            return jsonify({'success': False, 'error': 'URLの追加に失敗しました'}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/report-urls/<int:url_id>', methods=['DELETE'])
def delete_report_url(url_id):
    """報告先URLを削除"""
    try:
        deleted_url = task_manager.delete_report_url(url_id)
        if deleted_url:
            return jsonify({'success': True, 'url': deleted_url})
        else:
            return jsonify({'success': False, 'error': 'URLが見つかりません'}), 404
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/report-tabs', methods=['GET'])
def get_report_tabs():
    """報告先別の報告内容を取得"""
    try:
        # データ移行を確認
        task_manager.migrate_legacy_report_data()
        
        tab_data = task_manager.load_report_tabs()
        return jsonify({'success': True, 'tabs': tab_data})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/report-tabs/<tab_id>', methods=['GET'])
def get_report_tab_content(tab_id):
    """特定の報告先の報告内容を取得"""
    try:
        content = task_manager.get_report_tab_content(tab_id)
        return jsonify({'success': True, 'content': content})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/report-tabs/<tab_id>', methods=['POST'])
def save_report_tab_content(tab_id):
    """特定の報告先の報告内容を保存"""
    try:
        data = request.get_json()
        content = data.get('content', '')
        
        success = task_manager.save_report_tab_content(tab_id, content)
        if success:
            return jsonify({'success': True, 'message': '報告内容を保存しました'})
        else:
            return jsonify({'success': False, 'error': '報告内容の保存に失敗しました'}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    """ヘルスチェック"""
    return jsonify({'status': 'healthy', 'timestamp': datetime.datetime.now().isoformat()})

if __name__ == '__main__':
    print("Python API サーバーを起動中...")
    print("データディレクトリ:", DATA_DIR.absolute())
    app.run(host='127.0.0.1', port=5000, debug=False)