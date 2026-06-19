import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const { email, password, inviteCode } = await request.json();

  const expected = process.env.INVITE_CODE;
  if (!expected || inviteCode !== expected) {
    return NextResponse.json(
      { error: "Incorrect invite code. Access denied." },
      { status: 403 }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ requiresConfirmation: !data.session });
}