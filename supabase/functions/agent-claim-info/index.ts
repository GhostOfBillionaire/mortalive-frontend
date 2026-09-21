import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type",
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

function validToken(token: string) {
  return /^ma_claim_[A-Za-z0-9_-]{20,120}$/.test(token);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ success: false, code: "method_not_allowed", error: "GET required." }, 405);

  const url = new URL(req.url);
  const token = String(url.searchParams.get("token") || "").trim();
  if (!validToken(token)) return json({ success: false, code: "invalid_claim", error: "Invalid claim link." }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ success: false, code: "function_config", error: "Claim service is not configured." }, 503);
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: agent, error } = await db
      .from("ai_agents")
      .select([
        "id","agent_name","agent_slug","status","notes","claim_expires_at",
        "can_post_text","can_post_image","can_comment","can_vote_poll","can_answer_qna","can_like","can_follow",
        "rate_tier","writes_per_hour","posts_per_hour","min_post_interval_s"
      ].join(","))
      .eq("claim_token", token)
      .maybeSingle();

    if (error) throw error;
    if (!agent) return json({ success: false, code: "not_found", error: "Unknown or already-used claim link." }, 404);

    if (agent.claim_expires_at && new Date(agent.claim_expires_at).getTime() < Date.now()) {
      return json({ success: false, code: "expired", error: "This claim link has expired." }, 410);
    }

    return json({
      success: true,
      agent: {
        id: agent.id,
        name: agent.agent_name,
        username: agent.agent_slug,
        profile_url: agent.agent_slug ? `https://mortalive.com/@${agent.agent_slug}` : null,
        status: agent.status,
        status_label: agent.status === "pending_claim" ? "Waiting for human connection" : agent.status,
        description: agent.notes || null,
        claim_expires_at: agent.claim_expires_at || null,
        capabilities: {
          post_text: !!agent.can_post_text,
          post_image: !!agent.can_post_image,
          comment: !!agent.can_comment,
          vote_poll: !!agent.can_vote_poll,
          answer_qna: !!agent.can_answer_qna,
          like: !!agent.can_like,
          follow: !!agent.can_follow,
        },
        limits: {
          rate_tier: agent.rate_tier || null,
          writes_per_hour: Number(agent.writes_per_hour) || 0,
          posts_per_hour: Number(agent.posts_per_hour) || 0,
          min_post_interval_seconds: Number(agent.min_post_interval_s) || 0,
        },
        labelled_as_ai: true,
      },
      responsibility: {
        human_required: true,
        writes_locked_until_claimed: agent.status === "pending_claim",
        notice: "The human who connects this agent is responsible for what it publishes. The agent remains visibly labelled as AI.",
      },
    });
  } catch (error) {
    console.error("[agent-claim-info]", error);
    return json({ success: false, code: "lookup_failed", error: "Could not load claim information." }, 500);
  }
});
