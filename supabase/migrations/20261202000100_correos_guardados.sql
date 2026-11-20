-- =====================================================================
-- Correos guardados: cada correo queda registrado con su contenido. Los que no
-- se pudieron enviar (correo mal configurado o caído) quedan «pendientes» y se
-- reenvían cuando el correo vuelve a funcionar. Los de seguridad (enlaces para
-- crear contraseña o cambiar correo) no se guardan con su enlace: se piden de nuevo.
-- =====================================================================
alter table public.mail_log add column if not exists html text;
alter table public.mail_log add column if not exists text_body text;
alter table public.mail_log add column if not exists attempts int not null default 1;
alter table public.mail_log add column if not exists resent_at timestamptz;
create index if not exists mail_log_pending_idx on public.mail_log (status, created_at) where status in ('failed', 'off') and resent_at is null;
