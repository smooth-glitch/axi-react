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
