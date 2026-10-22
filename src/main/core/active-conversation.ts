let activeConversationId: string | null = null

export function getActiveConversationId(): string | null {
  return activeConversationId
}

export function rememberActiveConversation(id: string | null): void {
  activeConversationId = id
}
