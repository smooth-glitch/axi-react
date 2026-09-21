import { useThreadVersion, getActiveChat } from '../store';
import MessageBubble from './MessageBubble';

// Ported from renderThread (script.js) — reads the exact same
// window.state.chats/activeChatId. The home-screen-vs-thread visibility
// toggle (axi-ui-polish.js's MutationObserver watching #messages' childList)
// and the auto-scroll-to-bottom MutationObserver (enableAutoScroll) both stay
// as-is and keep working unchanged — they don't care whether React or
// vanilla JS is what mutates #messages' children.
export default function MessageThread() {
  useThreadVersion();
  const chat = getActiveChat();

  if (!chat || !chat.messages.length) return null;

  return (
    <>
      {chat.messages.map((m, idx) => (
        <MessageBubble key={idx} message={m} idx={idx} isLast={idx === chat.messages.length - 1} />
      ))}
    </>
  );
}
