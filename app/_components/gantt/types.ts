export type GanttLane = {
  id: string;
  name: string;
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
