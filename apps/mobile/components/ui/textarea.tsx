import { Platform, TextInput } from "react-native";

import { cn } from "@/lib/utils";

function Textarea({
  className,
  multiline = true,
  numberOfLines = Platform.select({ native: 8, web: 2 }), // On web, numberOfLines also determines initial height. On native, it determines the maximum height.
  placeholderClassName,
  ...props
}: React.ComponentProps<typeof TextInput> & React.RefAttributes<TextInput>) {
  return (
    <TextInput
      className={cn(
        "flex min-h-16 w-full flex-row rounded-md border border-input bg-transparent px-3 py-2 font-sans text-base text-foreground shadow-sm shadow-black/5 dark:bg-input/30 md:text-sm",
        Platform.select({
          web: "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive field-sizing-content resize-y outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed",
        }),
        props.editable === false && "opacity-50",
        className
      )}
      placeholderClassName={cn("text-muted-foreground", placeholderClassName)}
      multiline={multiline}
      numberOfLines={numberOfLines}
      textAlignVertical="top"
      {...props}
    />
  );
}

export { Textarea };
