# Vavilov Explorer: preparing your table

This guide, of 2 October 2026, says how to prepare the table you import
into Vavilov Explorer, so that the import accepts it and every column can
be used the way you want.

Vavilov Explorer reads one table, a CSV, TSV or Excel file, with one row
per individual (an accession, a plant, an animal) and one column per
variable. The first row holds the names of the columns.

## The first column: IndividualID

The first column holds the ID of each individual, and its header must be
`IndividualID`. Case, spaces and underscores do not matter, so
`Individual ID`, `individual_id` and `INDIVIDUALID` are accepted too.

- Every row needs an ID, and no ID may appear twice.
- IDs are kept exactly as written: `001` stays `001`, and `NA` is an ID,
  not a missing value.
- A file whose first column has another header, such as `accession`, is
  refused: nothing of it is imported, and the message names the header
  found. Rename the column and import the file again.

## Missing values

In every column but the first, three things mean a missing value: an
empty cell, `NA` and `-`, written exactly so. `na`, `N/A` and `n.d.` are
text, not missing values. Do not use `NA` or `-` for a real value: in a
column of two-letter country codes, Namibia's code `NA` is read as a
missing value, so write Namibia as `NAM` or `Namibia`.

## What each column is for

After the import, each column but the first has a role, which you choose
in the dropdown at the top of the column:

- **Number**: values drawn on an axis or in a histogram.
- **Category**: values that divide the individuals into groups, such as
  the colour of the flower, the country of origin or a genetic
  clustering. A category is drawn in bar plots, and you can choose any
  category in the populations panel to work with its groups as
  populations: to colour the plots by them, and to move individuals
  from one to another by drawing around them in a plot. Moving
  individuals changes the column in the app, never the file you
  imported; you choose which category to edit, so take care not to edit
  a trait you recorded by mistake.
- **Text**: notes and identifiers, shown in the table only.

Three roles are more particular forms of these, for columns whose every
value fits them: **Latitude** and **Longitude**, numbers the map uses to
place each individual, and **Country**, a category whose values are
countries. The dropdown lists only the roles a column can take, and you
can change a column's role at any time.

### Latitude and longitude

A column of numbers can be a latitude when every value is from −90 to
90, and a longitude when every value is from −180 to 180, written as
decimal degrees: `40.4168`, `-3.7038`. Missing values are allowed.
Coordinates in metres, a longitude from 0 to 360, or degrees written as
text such as `40°25'N` cannot be a latitude or a longitude; convert them
to decimal degrees in the file first.

### Countries

A column of text can be a country when every value names a country. The countries are those of ISO 3166,
the international standard list of countries and their codes, and a
value can name one in any of these ways:

- its two-letter code, such as `ES`, or its three-letter one, such as
  `ESP`;
- its English name as ISO 3166 writes it, such as `Spain`, or
  `Bolivia, Plurinational State of`;
- its short English name as world maps write it, in Natural Earth, the
  map data the app uses, such as `Bolivia` or `South Korea`.

Case and spaces at either end do not matter; accents do, so write
`Côte d'Ivoire`, not `Cote d'Ivoire`. Names in other languages, such as
`España`, are not accepted. Once the column is a country column, every
value is shown as its three-letter code, so `ES` and `Spain` become one
population, `ESP`.

Countries that no longer exist, such as the USSR or Yugoslavia, are
accepted as ISO 3166 lists them:

- by their ISO name, which is often long: `USSR, Union of Soviet
  Socialist Republics`, not `USSR`;
- by their four-letter code, which ISO 3166 gives every former country:
  `SUHH` for the USSR, `YUCS` for Yugoslavia, `CSHH` for Czechoslovakia,
  `DDDE` for the German Democratic Republic, `ZRCD` for Zaire;
- by their two- or three-letter code, such as `SU` or `SUN`, unless a
  country that exists today now has that code. For example, `AI` was the
  French Territory of the Afars and the Issas and is now Anguilla, so
  `AI` means Anguilla; write the former territory as `AIDJ` or by its
  name.

A country that no longer exists is shown by its three-letter code: the
USSR as `SUN`, the French Territory of the Afars and the Issas as `AFI`.
When a country that exists today has that three-letter code, the former
one is shown by its four-letter code: the French Southern and Antarctic
Territories as `FQHH`, since `ATF` is the French Southern Territories of
today.
