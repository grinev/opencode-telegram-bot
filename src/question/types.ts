export interface QuestionOption {
  label: string;
  description: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiple?: boolean;
}

export interface QuestionAnswer {
  question: string;
  answer: string;
}

export interface QuestionState {
  questions: Question[];
  currentIndex: number;
  selectedOptions: Map<number, Set<number>>;
  customAnswers: Map<number, string>;
  customInputQuestionIndex: number | null;
  activeMessageId: number | null;
  messageIds: number[];
  isActive: boolean;
  requestID: string | null;
}
