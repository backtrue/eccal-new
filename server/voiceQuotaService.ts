import { VoiceQuotaError, voiceMemberId, voiceOperationId } from '../shared/voiceQuota';
import type { VoiceQuotaRepository } from './voiceQuotaRepository';

export function createVoiceQuotaService(deps: {
  repository: VoiceQuotaRepository;
  getUser: (id: string) => Promise<{ id: string } | null | undefined>;
}) {
  async function member(id: string) {
    if (!voiceMemberId.safeParse(id).success) throw new VoiceQuotaError('INVALID_REQUEST', 400);
    const user = await deps.getUser(id);
    if (!user || user.id !== id) throw new VoiceQuotaError('MEMBER_NOT_FOUND', 404);
  }
  return {
    async identity(id: string) { await member(id); return { memberId: id, eligible: true }; },
    async balance(id: string) { await member(id); return deps.repository.balance(id); },
    async reserve(id: string, operationId: string) {
      await member(id);
      if (!voiceOperationId.safeParse(operationId).success) throw new VoiceQuotaError('INVALID_REQUEST', 400);
      return deps.repository.reserve(id, operationId);
    },
    async settle(id: string, reservationId: string, events: unknown) { await member(id); return deps.repository.settle(id, reservationId, events); },
  };
}
export type VoiceQuotaService = ReturnType<typeof createVoiceQuotaService>;
