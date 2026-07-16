import { NextResponse } from 'next/server';
import { workerFetch } from '@/lib/worker';
export async function GET(){try{const r=await workerFetch('/suppression');return NextResponse.json(await r.json(),{status:r.status});}catch{return NextResponse.json({error:'worker indisponível'},{status:502});}}
export async function POST(req:Request){const body=await req.json().catch(()=>({}));try{const r=await workerFetch('/suppression',{method:'POST',body:JSON.stringify(body)});return NextResponse.json(await r.json(),{status:r.status});}catch{return NextResponse.json({error:'worker indisponível'},{status:502});}}
export async function DELETE(req:Request){const jid=new URL(req.url).searchParams.get('jid')||'';try{const r=await workerFetch(`/suppression?jid=${encodeURIComponent(jid)}`,{method:'DELETE'});return NextResponse.json(await r.json(),{status:r.status});}catch{return NextResponse.json({error:'worker indisponível'},{status:502});}}
