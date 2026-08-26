export type GraphNode = {
  id: string;
  title: string;
  path: string;
  group: string;
  kind?: "note" | "cluster";
  noteCount?: number;
};

export type GraphEdge = {
  source: string;
  target: string;
};

export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};
