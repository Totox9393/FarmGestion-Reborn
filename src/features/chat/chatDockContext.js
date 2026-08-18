import { createContext, useContext } from 'react';

export const ChatDockContext = createContext(null);

export function useChatDock() {
  const context = useContext(ChatDockContext);
  if (!context) throw new Error('useChatDock doit être utilisé dans ChatDockProvider.');
  return context;
}
