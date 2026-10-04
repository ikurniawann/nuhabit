export function nextCardPresence(input: {
  hadCard: boolean;
  hasCard: boolean;
}): { hadCard: boolean; emit: boolean } {
  if (input.hasCard && !input.hadCard) {
    return { hadCard: true, emit: true };
  }
  if (!input.hasCard) {
    return { hadCard: false, emit: false };
  }
  return { hadCard: true, emit: false };
}
