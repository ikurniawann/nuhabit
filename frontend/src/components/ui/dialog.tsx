"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

/** Structured modal shell — use with DialogPanelHeader, DialogPanelBody, DialogFooter */
const dialogPanelVariants = cva(
  "flex w-full max-h-[min(var(--dialog-panel-max-height,88vh),900px)] flex-col gap-0 overflow-hidden rounded-card bg-card p-0 text-sm text-foreground shadow-float outline-none",
  {
    variants: {
      size: {
        xs: "sm:max-w-[420px]",
        sm: "sm:max-w-lg",
        md: "sm:max-w-2xl",
        lg: "sm:max-w-3xl",
        xl: "sm:max-w-4xl",
        "2xl": "sm:max-w-6xl",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
)

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-ink/50 backdrop-blur-[2px] duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-card bg-card p-6 text-sm text-foreground shadow-float duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex w-full shrink-0 flex-col-reverse gap-3 border-t border-border bg-surface-2 px-6 py-4 sm:flex-row sm:justify-end sm:gap-3",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogPanel({
  className,
  size,
  showCloseButton = true,
  style,
  children,
  ...props
}: DialogPrimitive.Popup.Props &
  VariantProps<typeof dialogPanelVariants> & {
    showCloseButton?: boolean
  }) {
  return (
    <DialogContent
      showCloseButton={showCloseButton}
      className={cn(dialogPanelVariants({ size }), className)}
      style={style}
      {...props}
    >
      {children}
    </DialogContent>
  )
}

function DialogPanelHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <DialogHeader
      data-slot="dialog-panel-header"
      className={cn(
        "shrink-0 gap-1 border-b border-gray-200/70 px-6 py-4 pr-12",
        className
      )}
      {...props}
    />
  )
}

function DialogPanelTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogTitle
      className={cn("text-lg font-semibold leading-snug text-foreground", className)}
      {...props}
    />
  )
}

function DialogPanelDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogDescription
      className={cn("mt-1 text-sm leading-5 text-muted-foreground", className)}
      {...props}
    />
  )
}

function DialogPanelToolbar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-panel-toolbar"
      className={cn("shrink-0 border-b border-border px-6 py-3", className)}
      {...props}
    />
  )
}

function DialogPanelBody({
  className,
  scroll = true,
  ...props
}: React.ComponentProps<"div"> & { scroll?: boolean }) {
  return (
    <div
      data-slot="dialog-panel-body"
      className={cn(
        "min-h-0 flex-1 px-6 py-4",
        scroll && "overflow-y-auto",
        className
      )}
      {...props}
    />
  )
}

/** Wrap form content so header/body/footer stack correctly inside DialogPanel */
function DialogPanelForm({ className, ...props }: React.ComponentProps<"form">) {
  return (
    <form
      data-slot="dialog-panel-form"
      className={cn("flex min-h-0 flex-1 flex-col", className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogPanelToolbar,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  dialogPanelVariants,
}
