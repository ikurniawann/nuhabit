export type ActivityType =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'STATUS_CHANGE'
  | 'APPROVE'
  | 'REJECT';

export type ActivityModule =
  | 'PO'
  | 'GRN'
  | 'SUPPLIER'
  | 'RAW_MATERIAL'
  | 'PRODUCT'
  | 'PRICE_LIST'
  | 'DELIVERY'
  | 'RETURN'
  | 'INVENTORY';

export interface ActivityLog {
  id: string;
  type: ActivityType;
  module: ActivityModule;
  title: string;
  description: string;
  recordId?: string;
  recordNumber?: string;
  timestamp: string;
  isRead: boolean;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export interface ActivityLogState {
  logs: ActivityLog[];
  unreadCount: number;
  addLog: (log: Omit<ActivityLog, 'id' | 'timestamp' | 'isRead'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
  clearOlderThan: (days: number) => void;
}
