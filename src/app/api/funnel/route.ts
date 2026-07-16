import { NextResponse } from 'next/server';
import { workerFetch } from '@/lib/worker';
export async function GET(){try{const r=await workerFetch('/funnel');return NextResponse.json(await r.json(),{status:r.status});}catch{return NextResponse.json({error:'worker indisponível'},{status:502});}}
