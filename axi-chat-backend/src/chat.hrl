%%% Shared limits between the raw TCP and WebSocket front doors. Kept
%%% low enough that one abusive client can't grow server memory or
%%% flood every other connected client with oversized messages.
-define(MAX_USERNAME_LEN, 24).
-define(MAX_GROUP_NAME_LEN, 32).
-define(MAX_MESSAGE_LEN, 2000).
-define(MAX_WS_FRAME_LEN, 65536).

%% Per-connection command rate limit -- 30 commands per 10s window (a
%% generous allowance for real typing/chat use, well below what a flood
%% script would send) is enough to stop one connection from hammering
%% chat_room/chat_groups/Redis or spamming every other connected client.
-define(RATE_LIMIT_MAX_COMMANDS, 30).
-define(RATE_LIMIT_WINDOW_MS, 10000).

%% Same window, separate budget, for the read-only #command menu helpers
%% (/cmds, /cmdcomplete) -- see chat_web:is_hint_line/1.
-define(HINT_LIMIT_MAX_COMMANDS, 120).

%% POST /upload rate limit -- 20 uploads per 60s window, per client IP.
%% Unlike WS commands, an upload is a brand-new plain-HTTP connection every
%% time (no persistent per-connection process to hold state in), and each
%% one can be up to 8MB -- with nothing else stopping repeated uploads, one
%% client could otherwise hammer disk I/O and space indefinitely. 20/60s is
%% generous for real use (sharing a handful of images/voice notes in quick
%% succession) and well below anything resembling abuse.
-define(UPLOAD_RATE_LIMIT_MAX, 20).
-define(UPLOAD_RATE_LIMIT_WINDOW_MS, 60000).
