export type GanttLane = {
  id: string;
  // レーン名はUI上不要になったため任意（既存データ互換のため残す）
  name?: string;
  order: number;
};

export type GanttTask = {
  id: string;
  title: string;
  laneId: string;
  startDate: string; // YYYY-MM-DD (inclusive)
  endDate: string; // YYYY-MM-DD (inclusive)
  memo?: string;
  color?: string;
  // 自由配置（縦位置）: px。未指定はクライアント側で自動割当。
  y?: number;
  // 重なり順: 大きいほど手前。未指定はクライアント側で自動割当。
  z?: number;
};

export type GanttDoc = {
  key: string;
  lanes: GanttLane[];
  tasks: GanttTask[];
  updatedAt?: string;
};
