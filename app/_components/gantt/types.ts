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
};

export type GanttDoc = {
  key: string;
  lanes: GanttLane[];
  tasks: GanttTask[];
  updatedAt?: string;
};
