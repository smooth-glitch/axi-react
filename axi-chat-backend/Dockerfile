# Builds via rebar3 (fetches eredis from Hex) and runs the compiled beams
# directly with erl -- no relx release yet, this mirrors exactly how the
# project runs locally. Deploys to the boss's VM alongside a Redis instance
# (see docs in the axi-react repo's NEXT_STEPS.md for the CI/CD plan).
FROM erlang:27-alpine AS build
WORKDIR /app
COPY rebar.config rebar.lock ./
COPY tools ./tools
COPY src ./src
RUN chmod +x tools/rebar3 && ./tools/rebar3 compile

FROM erlang:27-alpine
WORKDIR /app
COPY --from=build /app/_build/default/lib/axi_chat_backend/ebin ./ebin
COPY --from=build /app/_build/default/lib/eredis/ebin ./deps/eredis/ebin
EXPOSE 8080
# REDIS_HOST/REDIS_PORT/REDIS_PASSWORD are read by chat_redis.erl at
# startup -- override these at `docker run`/compose time for the VM's real
# Redis instance rather than editing this file.
ENV REDIS_HOST=127.0.0.1
ENV REDIS_PORT=6379
# No -sname/-name: only needed locally for the hot-reload dev workflow
# (RPC into a named node), unnecessary complexity in a container that just
# gets redeployed on every push. start_web_only, not start: a hosted
# deploy only ever exposes one port to the internet -- see
# chat_app:start_web_only/1's doc comment for why opening the raw TCP port
# too would be actively dangerous here.
CMD ["sh", "-c", "erl -noshell -pa ebin -pa deps/eredis/ebin -s chat_app start_web_only ${PORT:-8080}"]
