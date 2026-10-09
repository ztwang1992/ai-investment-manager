-- 阶段 5：计划里记下最后一次标记「再平衡已完成」的日期。这一期标记过就不再提醒，到下一期再看（各设备同步）。
alter table public.plans add column if not exists last_rebalanced_on date;
