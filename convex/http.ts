import { httpRouter } from "convex/server";
import {WebhookEvent} from "@clerk/nextjs/server"
import {Webhook} from "svix"
import {api} from "./_generated/api"
import {httpAction} from './_generated/server'
import { request } from "http";

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




    // function validateWorkoutPlan(plan: any) {
    //     const validatedPlan = {
    //         schedule: plan.schedule,
    //         exercises: plan.exercises.map((exercise: any) => ({
    //             day: exercise.day,
    //             routines: exercise.routines.map((routine: any) => ({
    //                 name: routine.name,
    //                 sets: typeof routine.sets === "number" ? routine.sets : parseInt(routine.sets) || 1,
    //                 reps: typeof routine.reps === "number" ? routine.reps : parseInt(routine.reps) || 10,
    //             })),
    //         })),
    //     }
    //     return validatedPlan
    // }


    // function validateDietPlan(plan: any) {
    //     const validatedPlan = {
    //         dailyCalories: plan.dailyCalories,
    //         meals: plan.meals.map((meal: any) => ({
    //             name: meal.name,
    //             foods: meal.foods,
    //         })),
    //     }
    //     return validatedPlan
    // }

export default http