import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

function hasValidCronAuthorization(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization?.startsWith("Bearer ")) {
    return false;
  }

  const received = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(secret, "utf8");
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

export async function GET(request: NextRequest) {
  if (!hasValidCronAuthorization(request)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc(
      "fn_close_expired_assessment_cycles"
    );

    if (error) {
      console.error("[cron/assessment-cycles] Falha ao encerrar ciclos");
      return NextResponse.json(
        { error: "Falha ao encerrar ciclos" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, closed: Number(data ?? 0) });
  } catch {
    console.error("[cron/assessment-cycles] Configuração indisponível");
    return NextResponse.json(
      { error: "Configuração indisponível" },
      { status: 503 }
    );
  }
}
