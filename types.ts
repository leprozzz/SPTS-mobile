
export interface Ticket {
  id: string;
  number: string;
  title: string;
  age: string;
  state: string;
  queue: string;
  owner: string;
  sla?: string;
  priority?: string;
}

export interface TicketDetail extends Ticket {
  subject: string;
  ticket: {
    state: string;
    sla: string;
    priority: string;
    queue: string;
    service: string;
    reportTime: string;
  };
  location?: {
    name: string | null;
    street: string | null;
    zip: string | null;
    city: string | null;
    country: string | null;
    phone: string | null;
    email: string | null;
  };
  articles: string[];
}

export interface FreeFieldOption {
  value: string;
  text: string;
  selected?: boolean;
}

export interface FreeField {
  name: string;
  id: string;
  tag: string;
  type: string;
  label: string;
  required: boolean;
  value: string;
  options?: FreeFieldOption[];
}

export enum AppView {
  DASHBOARD = 'DASHBOARD',
  AI_HELPER = 'AI_HELPER',
  EXTERNAL_APPS = 'EXTERNAL_APPS'
}
