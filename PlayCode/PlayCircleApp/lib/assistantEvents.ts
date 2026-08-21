// Lets independent parts of the app (a specific screen, and the globally-
// mounted assistant bubble) know when data changed without either needing
// to know the other exists. The assistant fires an event after a
// successful confirmed action; any currently-mounted screen showing that
// same entity re-fetches. No external state-management library needed for
// something this narrow — just enough to fix "I asked the assistant to
// score a point but the screen still shows the old score until I navigate
// away and back."

export type DataChangedEvent = {
  entityType: 'circle' | 'game' | 'match';
  entityId: string;
};

type Listener = (event: DataChangedEvent) => void;

const listeners = new Set<Listener>();

export function emitDataChanged(event: DataChangedEvent): void {
  listeners.forEach((listener) => listener(event));
}

// Returns an unsubscribe function — call it from a useEffect cleanup so a
// screen doesn't keep reacting to events after it's unmounted.
export function subscribeToDataChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
