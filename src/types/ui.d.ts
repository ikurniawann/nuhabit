// Type declarations for UI components

declare module "@/components/ui/card" {
  import * as React from "react";
  
  export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: "default" | "ink" | "accent" | "soft";
    size?: "default" | "sm";
  }
  export const Card: React.FC<CardProps>;
  
  export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}
  export const CardHeader: React.FC<CardHeaderProps>;
  
  export interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {}
  export const CardTitle: React.FC<CardTitleProps>;
  
  export interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {}
  export const CardContent: React.FC<CardContentProps>;

  export const CardAction: React.FC<React.HTMLAttributes<HTMLDivElement>>;
  export const CardDescription: React.FC<React.HTMLAttributes<HTMLDivElement>>;
  export const CardFooter: React.FC<React.HTMLAttributes<HTMLDivElement>>;
}

declare module "@/components/ui/button" {
  import * as React from "react";
  
  export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?:
      | "default"
      | "primary"
      | "ink"
      | "destructive"
      | "outline"
      | "secondary"
      | "soft"
      | "card"
      | "ghost"
      | "onInk"
      | "link";
    size?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";
    asChild?: boolean;
  }
  
  export const Button: React.FC<ButtonProps>;
  export const buttonVariants: (props?: {
    variant?: ButtonProps["variant"];
    size?: ButtonProps["size"];
    className?: string;
  }) => string;
}

declare module "@/components/ui/badge" {
  import * as React from "react";
  
  export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?:
      | "default"
      | "accent"
      | "ink"
      | "secondary"
      | "success"
      | "warning"
      | "info"
      | "destructive"
      | "muted"
      | "outline"
      | "ghost"
      | "link";
    size?: "default" | "lg";
  }
  
  export const Badge: React.FC<BadgeProps>;
}

declare module "@/components/ui/input" {
  import * as React from "react";
  
  export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}
  export const Input: React.FC<InputProps>;
}

declare module "@/components/ui/textarea" {
  import * as React from "react";
  
  export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}
  export const Textarea: React.FC<TextareaProps>;
}

declare module "@/components/ui/label" {
  import * as React from "react";
  
  export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {}
  export const Label: React.FC<LabelProps>;
}

declare module "@/components/ui/select" {
  import * as React from "react";
  
  export interface SelectProps {
    value?: string;
    defaultValue?: string;
    onValueChange?: (value: string) => void;
    children?: React.ReactNode;
    disabled?: boolean;
  }
  export const Select: React.FC<SelectProps>;
  
  export interface SelectTriggerProps extends React.HTMLAttributes<HTMLButtonElement> {}
  export const SelectTrigger: React.FC<SelectTriggerProps>;
  
  export interface SelectValueProps {
    placeholder?: string;
  }
  export const SelectValue: React.FC<SelectValueProps>;
  
  export interface SelectContentProps extends React.HTMLAttributes<HTMLDivElement> {}
  export const SelectContent: React.FC<SelectContentProps>;
  
  export interface SelectItemProps extends React.HTMLAttributes<HTMLDivElement> {
    value: string;
  }
  export const SelectItem: React.FC<SelectItemProps>;
}

declare module "@/components/ui/separator" {
  import * as React from "react";
  
  export interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
    orientation?: "horizontal" | "vertical";
  }
  export const Separator: React.FC<SeparatorProps>;
}
