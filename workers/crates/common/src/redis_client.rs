use anyhow::Result;
use redis::streams::{StreamReadOptions, StreamReadReply};
use redis::AsyncCommands;

/// Thin wrapper around a Redis Streams consumer group. Both the discovery
/// and scoring workers use this the same way: create the group once
/// (idempotent), then loop reading + acking. Consumer groups are what let
/// us run multiple worker instances of the same kind without double
/// processing, and get automatic redelivery if a worker dies mid-job
/// (see DESIGN.md §7d).
pub struct RedisStreams {
    conn: redis::aio::MultiplexedConnection,
    stream: String,
    group: String,
    consumer_name: String,
}

impl RedisStreams {
    pub async fn connect(
        redis_url: &str,
        stream: &str,
        group: &str,
        consumer_name: &str,
    ) -> Result<Self> {
        let client = redis::Client::open(redis_url)?;
        let mut conn = client.get_multiplexed_tokio_connection().await?;

        // MKSTREAM creates the stream if it doesn't exist yet; ignore the
        // error if the group already exists (BUSYGROUP).
        let created: Result<(), redis::RedisError> = conn
            .xgroup_create_mkstream(stream, group, "0")
            .await;
        if let Err(e) = created {
            if !e.to_string().contains("BUSYGROUP") {
                return Err(e.into());
            }
        }

        Ok(Self {
            conn,
            stream: stream.to_string(),
            group: group.to_string(),
            consumer_name: consumer_name.to_string(),
        })
    }

    /// Blocks (up to `block_ms`) waiting for new entries, returns raw
    /// (entry_id, json_payload) pairs for the caller to deserialize into
    /// DiscoveryJob / ScoringJob.
    pub async fn read_new(
        &mut self,
        block_ms: usize,
        count: usize,
    ) -> Result<Vec<(String, String)>> {
        let opts = StreamReadOptions::default()
            .group(&self.group, &self.consumer_name)
            .block(block_ms)
            .count(count);

        let reply: StreamReadReply = self
            .conn
            .xread_options(&[&self.stream], &[">"], &opts)
            .await?;

        let mut out = Vec::new();
        for key in reply.keys {
            for id in key.ids {
                if let Some(redis::Value::BulkString(bytes)) = id.map.get("payload") {
                    let payload = String::from_utf8_lossy(bytes).to_string();
                    out.push((id.id.clone(), payload));
                }
            }
        }
        Ok(out)
    }

    pub async fn ack(&mut self, entry_id: &str) -> Result<()> {
        self.conn
            .xack::<_, _, _, ()>(&self.stream, &self.group, &[entry_id])
            .await?;
        Ok(())
    }

    pub fn connection(&self) -> redis::aio::MultiplexedConnection {
        self.conn.clone()
    }
}
