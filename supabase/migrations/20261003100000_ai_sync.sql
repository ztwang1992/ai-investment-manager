-- 阶段 6：AI 对话同步到各设备。两张表在初始迁移里已经建好，这里补上增量拉取要用的服务器时间。
-- 对话：同设置类数据，以最后修改的为准（keep_latest），每次写入记下 server_updated_at；
-- 消息：同流水，只增不改，inserted_at 是服务器收到的时间。重复运行不出错。

alter table public.ai_conversations add column if not exists server_updated_at timestamptz not null default now();
drop trigger if exists ai_conversations_keep_latest on public.ai_conversations;
create trigger ai_conversations_keep_latest before insert or update on public.ai_conversations
  for each row execute function public.keep_latest();

alter table public.ai_messages add column if not exists inserted_at timestamptz not null default now();
create index if not exists ai_messages_user_inserted_at on public.ai_messages (user_id, inserted_at);
