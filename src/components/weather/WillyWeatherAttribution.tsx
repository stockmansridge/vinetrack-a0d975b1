// Small attribution shown wherever WillyWeather data is displayed.
export function WillyWeatherAttribution({ className }: { className?: string }) {
  return (
    <div className={`text-xs text-muted-foreground ${className ?? ""}`}>
      Weather forecast by{" "}
      <a
        href="https://www.willyweather.com.au"
        target="_blank"
        rel="noreferrer noopener"
        className="underline underline-offset-2 hover:text-foreground"
      >
        WillyWeather
      </a>
    </div>
  );
}
