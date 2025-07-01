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
        
        if self.data_file.exists():
            with open(self.data_file, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            print(f"読み込んだ行数: {len(lines)}")
            if lines:
                print("ファイル内容:")
                for i, line in enumerate(lines):
                    print(f"  {i+1}: {repr(line)}")
            
            task_data = []
            for line in lines:
                line = line.strip()
                if "~" in line:
                    # 時間範囲の行
                    start_time, end_time = line.split("~", 1)
                    task_data.extend([start_time.strip(), end_time.strip()])
                else:
                    # タスク名の行
                    if line:
                        task_data.append(line)
                        if len(task_data) >= 3:
                            # 終了時刻の処理：空文字列、"None"、"none"をNoneとして扱う
                            end_time = task_data[1].strip() if task_data[1] else ""
                            if end_time.lower() in ["", "none"]:
                                end_time = None
                            
                            task = {
                                'id': len(tasks),
                                'startTime': task_data[0],
                                'endTime': end_time,
                                'name': task_data[2]
                            }
                            tasks.append(task)
                            print(f"パースしたタスク: {task}")
                            task_data = []
        else:
            print("データファイルが存在しません")
        
        print(f"読み込み完了 - タスク数: {len(tasks)}")
        return tasks
    
    def save_schedule(self, tasks):
        """スケジュールデータを保存"""
        with open(self.data_file, 'w', encoding='utf-8') as f:
            for task in tasks:
                start_time = task['startTime']
                end_time = task.get('endTime', '')
                name = task['name']
                f.write(f"{start_time} ~ {end_time}\n{name}\n")
    
    def add_task(self, task_name):
        """タスクを追加"""
        tasks = self.load_schedule()
        add_time = self.get_time()
        
        # 未終了のタスクがあれば終了時刻を設定
        for task in tasks:
            if not task.get('endTime'):
                task['endTime'] = add_time
        
        # 新しいタスクを追加
        new_task = {
            'id': len(tasks),
            'startTime': add_time,
            'endTime': None,
            'name': task_name
        }
        tasks.append(new_task)
        
        self.save_schedule(tasks)
        return new_task
    
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
    
    def update_task(self, task_id, task_name, start_time, end_time):
        """タスクを更新"""
        try:
            tasks = self.load_schedule()
            if 0 <= task_id < len(tasks):
                tasks[task_id]['name'] = task_name
                tasks[task_id]['startTime'] = start_time
                tasks[task_id]['endTime'] = end_time if end_time.strip() else None
                self.save_schedule(tasks)
                return tasks[task_id]
            return None
        except Exception as e:
            print(f"タスク更新エラー: {e}")
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

# グローバルなTaskManagerインスタンス
task_manager = TaskManager()

@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    """タスク一覧を取得"""
    try:
        tasks = task_manager.load_schedule()
        return jsonify({'success': True, 'tasks': tasks})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/tasks', methods=['POST'])
def add_task():
    """タスクを追加"""
    try:
        data = request.get_json()
        task_name = data.get('name', '').strip()
        
        if not task_name:
            return jsonify({'success': False, 'error': 'タスク名が必要です'}), 400
        
        new_task = task_manager.add_task(task_name)
        return jsonify({
            'success': True, 
            'task': new_task,
            'taskId': new_task['id']
        })
    except Exception as e:
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
        
        updated_task = task_manager.update_task(task_id, task_name, start_time, end_time)
        if updated_task:
            return jsonify({'success': True, 'task': updated_task})
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

@app.route('/api/health', methods=['GET'])
def health_check():
    """ヘルスチェック"""
    return jsonify({'status': 'healthy', 'timestamp': datetime.datetime.now().isoformat()})

if __name__ == '__main__':
    print("Python API サーバーを起動中...")
    print("データディレクトリ:", DATA_DIR.absolute())
    app.run(host='127.0.0.1', port=5000, debug=False)