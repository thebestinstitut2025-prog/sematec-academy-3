import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

export const PAY_KEY = 'pagos';
export type PayConfig = { transfer: boolean; bank_info: string; office: boolean; office_info: string };

/** Datos para pagar por transferencia u oficina (los lee cualquiera que deba pagar). */
export async function loadPayConfig(orgId: string | null): Promise<PayConfig> {
  const def: PayConfig = { transfer: false, bank_info: '', office: true, office_info: '' };
  if (!orgId) return def;
  const admin = createAdminClient();
  const { data } = await admin.from('organization_settings').select('key, value').eq('organization_id', orgId).in('key', [PAY_KEY, 'inscripcion.general']);
  const v = (data ?? []).find((x) => x.key === PAY_KEY)?.value as Partial<PayConfig> | undefined;
  const reg = (data ?? []).find((x) => x.key === 'inscripcion.general')?.value as { bank_info?: string; office_info?: string } | undefined;
  return {
    transfer: v ? !!v.transfer : !!reg?.bank_info,
    bank_info: (v?.bank_info || reg?.bank_info || '').slice(0, 1500),
    office: v ? v.office !== false : true,
    office_info: (v?.office_info || reg?.office_info || '').slice(0, 1000),
  };
}
