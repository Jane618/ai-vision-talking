-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id              BIGSERIAL PRIMARY KEY,
    uuid            UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 会话表
CREATE TABLE IF NOT EXISTS conversations (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT REFERENCES users(id) ON DELETE CASCADE,
    session_uuid    VARCHAR(64) NOT NULL,
    title           VARCHAR(255),
    scene_preset    VARCHAR(50),
    quality_mode    VARCHAR(50),
    system_prompt   TEXT,
    summary         TEXT,
    summary_tokens  INT DEFAULT 0,
    saved_tokens    INT DEFAULT 0,
    total_cost_cny  DECIMAL(12,6) DEFAULT 0,
    is_deleted      BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 消息表
CREATE TABLE IF NOT EXISTS messages (
    id              BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content         JSONB NOT NULL,
    content_text    TEXT,
    has_image       BOOLEAN DEFAULT FALSE,
    image_refs      JSONB,
    prompt_tokens       INT,
    completion_tokens   INT,
    total_tokens        INT,
    tool_calls      JSONB,
    tool_call_id    VARCHAR(100),
    meta            JSONB,
    seq             INT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 图片表
CREATE TABLE IF NOT EXISTS images (
    id              BIGSERIAL PRIMARY KEY,
    uuid            UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    message_id      BIGINT REFERENCES messages(id) ON DELETE CASCADE,
    conversation_id BIGINT REFERENCES conversations(id) ON DELETE CASCADE,
    session_uuid    VARCHAR(64),
    image_data      BYTEA,
    image_url       TEXT,
    image_size      INT,
    image_width     INT,
    image_height    INT,
    image_quality   DECIMAL(3,2),
    complexity_score DECIMAL(3,2),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 摘要历史表
CREATE TABLE IF NOT EXISTS conversation_summaries (
    id                  BIGSERIAL PRIMARY KEY,
    conversation_id     BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    summary_text        TEXT NOT NULL,
    replaced_msg_count  INT NOT NULL,
    saved_tokens        INT NOT NULL,
    summary_tokens      INT NOT NULL,
    estimated_saved_cny DECIMAL(12,6),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 成本记录表
CREATE TABLE IF NOT EXISTS cost_records (
    id                  BIGSERIAL PRIMARY KEY,
    conversation_id     BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_id          BIGINT REFERENCES messages(id),
    call_number         INT NOT NULL,
    prompt_tokens       INT NOT NULL,
    completion_tokens   INT NOT NULL,
    total_tokens        INT NOT NULL,
    estimated_cost_cny  DECIMAL(12,6) NOT NULL,
    system_prompt_tokens INT,
    history_tokens      INT,
    current_user_tokens INT,
    image_tokens        INT,
    model_name          VARCHAR(100),
    latency_ms          INT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_messages_conversation_seq ON messages(conversation_id, seq);
CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_records_conversation ON cost_records(conversation_id, call_number);
CREATE INDEX IF NOT EXISTS idx_images_session ON images(session_uuid);

-- 兼容旧表迁移：session_uuid 从 UUID 改为 VARCHAR(64)
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'conversations' AND column_name = 'session_uuid'
        AND data_type = 'uuid'
    ) THEN
        ALTER TABLE conversations ALTER COLUMN session_uuid TYPE VARCHAR(64);
        ALTER TABLE conversations ALTER COLUMN session_uuid DROP DEFAULT;
    END IF;
END $$;
