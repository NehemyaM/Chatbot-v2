export interface Textbook {
  id: string;
  title: string;
  openaiFileId: string;
  vectorStoreId: string;
  workflowId?: string;
  status: string;
  createdAt: string;
}

export interface TextbookAnswer {
  answer: string;
  citations: Array<{
    fileId: string;
    filename: string;
    score: number;
  }>;
}
