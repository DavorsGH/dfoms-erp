import { cookies } from "next/headers";

import { createClient } from "@/utils/supabase/server";

import { CLIENT_SELECT, type ClientEntry } from "../operations/clients-utils";

import type { ServiceType } from "../service-types";

import FinanceNav from "./finance-nav";

import IncomeRegister from "./income-register";

import {

  normalizeIncomeRegisterEntry,

  SERVICE_INCOME_REGISTER_SELECT,

  type IncomeRegisterEntry,

} from "./income-register-utils";



export default async function FinancePage() {

  const cookieStore = await cookies();

  const supabase = createClient(cookieStore);



  const [

    { data, error },

    { data: serviceTypes, error: serviceTypesError },

    { data: clients, error: clientsError },

  ] = await Promise.all([

    supabase

      .from("income_register")

      .select(SERVICE_INCOME_REGISTER_SELECT)

      .or("entry_type.eq.service,entry_type.is.null")

      .order("date", { ascending: false }),

    supabase.from("service_types").select("name").order("name", { ascending: true }),

    supabase.from("clients").select(CLIENT_SELECT).order("client_name", { ascending: true }),

  ]);



  const fetchError =

    error?.message ?? serviceTypesError?.message ?? clientsError?.message ?? null;



  return (

    <div>

      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>

      <FinanceNav />

      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">

        Income Register

      </h2>

      <IncomeRegister

        initialEntries={

          (data as IncomeRegisterEntry[] | null)?.map((entry) =>

            normalizeIncomeRegisterEntry(entry),

          ) ?? []

        }

        initialServiceTypes={(serviceTypes as ServiceType[] | null) ?? []}

        initialClients={(clients as ClientEntry[] | null) ?? []}

        fetchError={fetchError}

      />

    </div>

  );

}

