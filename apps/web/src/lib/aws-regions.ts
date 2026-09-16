export interface RegionOption {
  readonly value: string;
  readonly label: string;
}

export const AWS_REGION_GROUPS: ReadonlyArray<{
  readonly group: string;
  readonly regions: ReadonlyArray<RegionOption>;
}> = [
  {
    group: "Americas",
    regions: [
      { value: "us-east-1", label: "N. Virginia" },
      { value: "us-east-2", label: "Ohio" },
      { value: "us-west-1", label: "N. California" },
      { value: "us-west-2", label: "Oregon" },
      { value: "ca-central-1", label: "Central Canada" },
      { value: "sa-east-1", label: "São Paulo" },
    ],
  },
  {
    group: "Europe / Middle East / Africa",
    regions: [
      { value: "eu-west-1", label: "Ireland" },
      { value: "eu-west-2", label: "London" },
      { value: "eu-west-3", label: "Paris" },
      { value: "eu-central-1", label: "Frankfurt" },
      { value: "eu-north-1", label: "Stockholm" },
      { value: "eu-south-1", label: "Milan" },
      { value: "il-central-1", label: "Tel Aviv" },
      { value: "me-central-1", label: "UAE" },
      { value: "af-south-1", label: "Cape Town" },
    ],
  },
  {
    group: "Asia Pacific",
    regions: [
      { value: "ap-south-1", label: "Mumbai" },
      { value: "ap-southeast-1", label: "Singapore" },
      { value: "ap-southeast-2", label: "Sydney" },
      { value: "ap-northeast-1", label: "Tokyo" },
      { value: "ap-northeast-2", label: "Seoul" },
      { value: "ap-east-1", label: "Hong Kong" },
    ],
  },
];

export const ALL_REGIONS: ReadonlyArray<RegionOption> = AWS_REGION_GROUPS.flatMap((g) => g.regions);
