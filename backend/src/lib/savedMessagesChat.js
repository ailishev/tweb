/**
 * Ensures every user has a dedicated Saved Messages chat (single-member, type saved).
 */
export async function ensureSavedMessagesChat(prisma, userId) {
  const existing = await prisma.chat.findUnique({
    where: {savedOwnerId: userId}
  });
  if(existing) {
    return existing;
  }

  return prisma.chat.create({
    data: {
      type: 'saved',
      title: 'Saved Messages',
      savedOwnerId: userId,
      members: {
        create: {userId, role: 'owner'}
      }
    }
  });
}
