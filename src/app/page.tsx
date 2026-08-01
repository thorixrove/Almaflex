"use client"
import { Show, SignInButton, SignOutButton } from '@clerk/nextjs'

const HomePage = () => {
  return (
    <div>
      Home
      <Show when="signed-out">
        <SignInButton />
      </Show>
      <Show when="signed-in">
        <SignOutButton />
      </Show>
    </div>
  )
}

export default HomePage