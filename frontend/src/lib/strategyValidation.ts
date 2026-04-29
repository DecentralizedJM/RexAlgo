export const MIN_STRATEGY_DESCRIPTION_CHARS = 50;

export function strategyDescriptionLength(value: string): number {
  return value.trim().length;
}

export function isStrategyDescriptionValid(value: string): boolean {
  return strategyDescriptionLength(value) >= MIN_STRATEGY_DESCRIPTION_CHARS;
}
