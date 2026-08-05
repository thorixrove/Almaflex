import { httpRouter } from "convex/server";
import {WebhookEvent} from "@clerk/nextjs/server"
import {Webhook} from "svix"
import {api} from "./_generated/api"
import {httpAction} from './_generated/server'

const http = httpRouter()

http.route({
    path: "/clerk-webhook",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        const webhookSecret = process.env.CLERK_WEBHOOK_SECRET
        if (!webhookSecret) {
            throw new Error("Kehilangan CLERK_WEBHOOK_SECRET environntmen variabel")
        }

        const svix_id = request.headers.get("svix-id")
        const svix_signature = request.headers.get("svix-signature")
        const svix_timestamp = request.headers.get("svix-timestamp")

        if (!svix_id || !svix_signature || !svix_timestamp) {
            return new Response("Tidak ada svix header yang ditemukan", {
                status: 400,
            })
        }

        const payload = await request.json()
        const body = JSON.stringify(payload)

        const wh = new Webhook(webhookSecret)
        let evt: WebhookEvent

        try {
            evt = wh.verify(body, {
                "svix-id": svix_id,
                "svix-timestamp": svix_timestamp,
                "svix-signature": svix_signature,
            }) as WebhookEvent
        } catch (err) {
            console.error("Error ketika memverivikasi webhook", err)
            return new Response("Error Terjadi", {status: 400})
        }

        const eventType = evt.type



        if (eventType === "user.created") {
            const { id, first_name, last_name, image_url, email_addresses } = evt.data;

            const email = email_addresses[0].email_address;

            const name = `${first_name || ""} ${last_name || ""}`.trim();

            try {
                await ctx.runMutation(api.users.syncUser, {
                email,
                name,
                image: image_url,
                clerkId: id,
                });
            } catch (error) {
                console.log("Error saat membuat user:", error);
                return new Response("Error membuat user", { status: 500 });
            }
            }



        if (eventType === "user.updated") {
              const { id, email_addresses, first_name, last_name, image_url } = evt.data;

            const email = email_addresses[0].email_address

            const name = `${first_name || ""} ${last_name || ""}`.trim()

            try {
                await ctx.runMutation(api.users.updateUser, {
                clerkId: id,
                email,
                name,
                image: image_url,
                })
            } catch (error) {
            console.log("Error saat update user:", error);
            return new Response("Error saat update user", { status: 500 });
            }
        }

         return new Response("Webhooks processed successfully", { status: 200 });
    }),
})


// Validasi & normalisasi hasil workout plan dari AI, sesuai schema (field "routine" singular)
function validateWorkoutPlan(plan: any) {
    const validatedPlan = {
        schedule: plan.schedule,
        exercises: plan.exercises.map((exercise: any) => ({
            day: exercise.day,
            routine: exercise.routine.map((r: any) => ({
                name: r.name,
                sets: typeof r.sets === "number" ? r.sets : parseInt(r.sets) || 1,
                reps: typeof r.reps === "number" ? r.reps : parseInt(r.reps) || 10,
            })),
        })),
    }
    return validatedPlan
}

function validateDietPlan(plan: any) {
    const validatedPlan = {
        dailyCalories: typeof plan.dailyCalories === "number" ? plan.dailyCalories : parseInt(plan.dailyCalories) || 2000,
        meals: plan.meals.map((meal: any) => ({
            name: meal.name,
            foods: meal.foods,
        })),
    }
    return validatedPlan
}

// Panggil Groq (Llama 3.3, OpenAI-compatible API) dan balikin JSON yang sudah di-parse
async function callGroq(prompt: string) {
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) {
        throw new Error("GROQ_API_KEY belum di-set di Convex Environment Variables")
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.4,
            response_format: { type: "json_object" },
        }),
    })

    if (!response.ok) {
        const errText = await response.text()
        throw new Error(`Groq API error: ${response.status} - ${errText}`)
    }

    const data = await response.json()
    const rawText: string = data.choices?.[0]?.message?.content || ""
    const cleaned = rawText.replace(/```json|```/g, "").trim()

    return JSON.parse(cleaned)
}

http.route({
    path: "/vapi/generate-program",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        const body = await request.json()

        // Format webhook Vapi custom tool: message.toolCallList berisi array tool call
        const toolCall = body?.message?.toolCallList?.[0]
        const toolCallId: string = toolCall?.id || "unknown"

        try {
            if (!toolCall) {
                throw new Error("Tidak ada toolCall ditemukan di payload")
            }

            // Argumen yang dikumpulkan AI dari percakapan (age, weight, dst)
            const args = toolCall.function?.arguments || {}

            // user_id dikirim lewat variableValues saat vapi.start() di frontend,
            // Vapi menyertakannya di message.call.assistantOverrides.variableValues
            const userId: string =
                body?.message?.call?.assistantOverrides?.variableValues?.user_id ||
                args.user_id ||
                "unknown_user"

            const {
                age,
                height,
                weight,
                injuries,
                workout_days,
                fitness_goal,
                fitness_level,
                dietary_restriction,
            } = args

            console.log("Payload tool call diterima:", { userId, age, height, weight, fitness_goal })

            const workoutPrompt = `Kamu adalah fitness coach berpengalaman. Buatkan program latihan berdasarkan data berikut:
Umur: ${age}
Tinggi: ${height} cm
Berat: ${weight} kg
Cedera/keterbatasan: ${injuries || "tidak ada"}
Hari latihan tersedia per minggu: ${workout_days}
Tujuan fitness: ${fitness_goal}
Level fitness: ${fitness_level}

Sebagai coach profesional:
- Pertimbangkan pembagian kelompok otot agar tidak overtraining otot yang sama di hari berturut-turut
- Sesuaikan gerakan dengan level fitness dan hindari gerakan berisiko untuk cedera yang disebutkan
- Fokuskan latihan sesuai tujuan fitness pengguna

ATURAN SCHEMA PENTING:
- Output HANYA boleh berisi field yang ditentukan, JANGAN tambah field lain
- "sets" dan "reps" HARUS berupa angka (number), bukan string
- Contoh benar: "sets": 3, "reps": 10
- JANGAN pakai teks seperti "reps": "sebanyak mungkin"
- Untuk cardio, gunakan "sets": 1, "reps": 1 atau angka lain yang sesuai

Balas dengan JSON PERSIS struktur ini, tanpa teks lain:
{
  "schedule": ["Senin", "Rabu", "Jumat"],
  "exercises": [
    {
      "day": "Senin",
      "routine": [
        { "name": "Nama Gerakan", "sets": 3, "reps": 10 }
      ]
    }
  ]
}`

            const rawWorkoutPlan = await callGroq(workoutPrompt)
            const workoutPlan = validateWorkoutPlan(rawWorkoutPlan)

            const dietPrompt = `Kamu adalah nutrition coach berpengalaman. Buatkan rencana diet berdasarkan data berikut:
Umur: ${age}
Tinggi: ${height} cm
Berat: ${weight} kg
Tujuan fitness: ${fitness_goal}
Pantangan makanan: ${dietary_restriction || "tidak ada"}

Sebagai nutrition coach profesional:
- Hitung kebutuhan kalori harian yang sesuai dengan data dan tujuan pengguna
- Buat rencana makan seimbang dengan distribusi makronutrien yang tepat
- Sertakan variasi makanan bergizi sambil menghormati pantangan yang disebutkan

ATURAN SCHEMA PENTING:
- Output HANYA boleh berisi field yang ditentukan, JANGAN tambah field lain seperti "supplements", "macros", atau "notes"
- "dailyCalories" HARUS berupa angka (number)
- Setiap meal hanya berisi "name" dan array "foods"

Balas dengan JSON PERSIS struktur ini, tanpa teks lain:
{
  "dailyCalories": 2200,
  "meals": [
    { "name": "Sarapan", "foods": ["Oatmeal", "Telur rebus"] },
    { "name": "Makan Siang", "foods": ["Nasi merah", "Ayam panggang", "Sayur"] }
  ]
}`

            const rawDietPlan = await callGroq(dietPrompt)
            const dietPlan = validateDietPlan(rawDietPlan)

            const planName = `${fitness_goal} Plan - ${new Date().toLocaleDateString("id-ID")}`

            const planId = await ctx.runMutation(api.plans.createPlan, {
                userId,
                name: planName,
                workoutPlan,
                dietPlan,
                isActive: true,
            })

            const summary = `Program "${planName}" berhasil dibuat dengan ${workoutPlan.schedule.length} hari latihan per minggu dan target ${dietPlan.dailyCalories} kalori per hari.`

            return new Response(
                JSON.stringify({
                    results: [
                        {
                            toolCallId,
                            result: summary,
                        },
                    ],
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            )
        } catch (error) {
            console.error("Error saat membuat rencana fitness:", error)

            return new Response(
                JSON.stringify({
                    results: [
                        {
                            toolCallId,
                            result: `Maaf, terjadi kesalahan saat membuat program: ${
                                error instanceof Error ? error.message : String(error)
                            }`,
                        },
                    ],
                }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            )
        }
    }),
})

export default http