grammar ExpressP11


entry ExpressFile: Syntax;
Schema_decl: "SCHEMA" name=Simple_id schema_version_id=String_literal? ";" body=Schema_body "END_SCHEMA" ";" ;
Schema_body: specifications+=Interface_specification* constant=Constant_decl? declarations+=(Declaration | Rule_decl)* ;
Schema_id returns string: Simple_id ;
Declaration: Entity_decl | Function_decl | Procedure_decl | Subtype_constraint_decl | Type_decl ;
Rule_decl: ruleHead=Rule_head algoHead=Algorithm_head stmts+=Stmt* where=Where_clause "END_RULE" ";" ;





Entity_decl: head=Entity_head body=Entity_body 'END_ENTITY' ";" ;
Entity_head: 'ENTITY' name=Simple_id types=Subsuper ";" ;
Entity_body: attributes+=Explicit_attr* derived=Derive_clause? inverse=Inverse_clause? unique=Unique_clause? (where=Where_clause)? ;

Subsuper: subtypes=Supertype_constraint? supertypes=Subtype_declaration? ;
Supertype_constraint: Abstract_supertype_declaration | Abstract_entity_declaration | Supertype_rule ;
Subtype_declaration: 'SUBTYPE' 'OF' "(" entities+=EntityRef ( "," entities+=EntityRef )* ")";

Abstract_supertype_declaration: "ABSTRACT" "SUPERTYPE" constraint=Subtype_constraint? ;
Subtype_constraint: "OF" "(" type=Supertype_expression ")" ;
Supertype_term: One_of | "(" Supertype_expression ")" | Entity_ref ;
One_of: "ONEOF" "(" types+=Supertype_expression ( "," types+=Supertype_expression )* ")" ;
Abstract_entity_declaration returns string: "ABSTRACT";
Supertype_rule: "SUPERTYPE" constraint=Subtype_constraint ;

Explicit_attr: attributes+=Attribute_decl ( "," attributes+=Attribute_decl )* ":" isOptional?="OPTIONAL"? type=Parameter_type ";" ;
Inverse_attr: attribute=Attribute_decl ":" ( ( "SET" | "BAG" ) bound=Bound_spec? "OF" )? ofEntity=[Entity_head:Simple_id] "FOR" ( forEntity=[Entity_head:Simple_id] "." )? forAttribute=[Attribute_decl:Simple_id] ";" ;

Attribute_decl : Redeclared_attribute | Attribute_id ;
Attribute_id : name=Simple_id;
Parameter_type : Generalized_types | Simple_types | Named_types ;
type NamedType = Entity_head | Type_decl |Resource_or_rename;
Named_types: of=[NamedType:Simple_id] ;
Simple_types  : Binary_type | Boolean_type | Integer_type | Logical_type | Number_type | Real_type | String_type ;
Binary_type: "BINARY" Width_spec? ;
Boolean_type returns string: "BOOLEAN";
Logical_type returns string: "LOGICAL";
Number_type returns string: "NUMBER";
String_type: "STRING" Width_spec? ;
Real_type: "REAL" ( "(" precision=Precision_spec ")" )? ;
Integer_type returns string: "INTEGER" ;
Width_spec: "(" width=Width ")" isFixed="FIXED"?;
Width: Numeric_expression ; 
Precision_spec: Numeric_expression ;

Generalized_types  : Aggregate_type | General_aggregation_types | Generic_entity_type | Generic_type ;
General_aggregation_types: General_array_type | General_bag_type | General_list_type | General_set_type ;
General_array_type  : "ARRAY" bound=Bound_spec? "OF" isOptional?="OPTIONAL"? isUnique?="UNIQUE"? type=Parameter_type ;
General_bag_type  : "BAG" bound=Bound_spec? "OF" type=Parameter_type ;
General_list_type  : "LIST" bound=Bound_spec? "OF" isUnique?="UNIQUE"? type=Parameter_type ;
General_set_type  : "SET" bound=Bound_spec? "OF" type=Parameter_type ;
Bound_spec: "[" lower=Bound_1 ":" upper=Bound_2 "]" ;
Bound_1: Numeric_expression ;
Bound_2: Numeric_expression ;

Instantiable_type: Concrete_types | Entity_ref ;
Underlying_type: Constructed_types | Concrete_types ; //FROM type_decl
Constructed_types: Enumeration_type | Select_type ;
Concrete_types: Aggregation_types | Simple_types | Type_ref ;
Aggregation_types: Array_type | Bag_type | List_type | Set_type ; // Instantiable versions
Array_type  : "ARRAY" bound=Bound_spec "OF" isOptional?="OPTIONAL"? isUnique?="UNIQUE"? type=Instantiable_type ;
Bag_type  : "BAG" bound=Bound_spec? "OF" type=Instantiable_type ;
List_type  : "LIST" bound=Bound_spec? "OF" isUnique?="UNIQUE"? type=Instantiable_type ;
Set_type  : "SET" bound=Bound_spec? "OF" type=Instantiable_type ;

Enumeration_type: isExtensible?="EXTENSIBLE"? "ENUMERATION" (( "OF" items=Enumeration_items ) | extension=Enumeration_extension )? ;
Enumeration_items: "(" items+=Enumeration_id ( "," items+=Enumeration_id )* ")" ;
Enumeration_extension: "BASED_ON" type=Type_ref ( "WITH" items=Enumeration_items )? ;

Select_type: ("EXTENSIBLE" "GENERIC_ENTITY"? )? "SELECT" select=(Select_list | Select_extension)? ; // withou GENERIC_ENTITY?
Select_list: "(" types+=[NamedType:Simple_id] ( "," types+=[NamedType:Simple_id])* ")" ;
Select_extension: "BASED_ON" type=Type_ref ("WITH" selectList=Select_list)? ;

Bit returns string: "0" | "1";
// Digits returns number: Digit+;
Binary_literal returns string: "%" Bit+ ;
// Integer_literal returns number: Digits ;
// Real_literal returns string: ( Digits "." Digits? ("e" Sign? Digits)? ) | Integer_literal ;
Logical_literal returns string: "FALSE" | "TRUE" | "UNKNOWN" ;
// Simple_string_literal returns string: "'" (( "'" "'" ) | Not_quote )* "'" ;
String_literal returns string: SIMPLE_STRING | Encoded_string_literal ;
Literal: value=(NUM | BINARY_LITERAL | Logical_literal | String_literal) ;
// Sign returns string: "+" | "-" ;
Built_in_constant returns string: "CONST_E" | "PI" | "SELF" | "?" ;


Derive_clause: "DERIVE" (attributes+=Derived_attr)+ ;
Inverse_clause: "INVERSE" (attributes+=Inverse_attr)+ ;
Unique_clause: "UNIQUE" (rules+=Unique_rule)+ ;
Where_clause: "WHERE" (rules+=Domain_rule)+ ;



// TODO
Syntax: schemas+=Schema_decl (schemas+=Schema_decl)*;
Interface_specification: Reference_clause | Use_clause ;

Procedure_decl: head=Procedure_head algoHead=Algorithm_head stmts+=Stmt* "END_PROCEDURE" ";" ;
Procedure_head: "PROCEDURE" name=Procedure_id ( "(" "VAR"? parameters+=Formal_parameter ( ";" "VAR"? parameters+=Formal_parameter )* ")")? ";" ;
Procedure_id returns string: Simple_id ;

Subtype_constraint_body: isAbstract?=Abstract_supertype? totalOver=Total_over? (supertypeExpress=Supertype_expression ";")? ;
Subtype_constraint_decl: head=Subtype_constraint_head body=Subtype_constraint_body "END_SUBTYPE_CONSTRAINT" ";" ;
Subtype_constraint_head: "SUBTYPE_CONSTRAINT" name=Subtype_constraint_id "FOR" type=Entity_ref ";" ;
Subtype_constraint_id returns string: Simple_id ;
Abstract_supertype returns string: "ABSTRACT" "SUPERTYPE" ";" ;

Supertype_expression: factors+=Supertype_factor ( "ANDOR" factors+=Supertype_factor )* ;
Supertype_factor: terms+=Supertype_term ( "AND" terms+=Supertype_term )* ;

// Embedded_remark returns string: "(*"   "*)" ;
// //Embedded_remark : "(*"  Remark_tag  { ( Not_paren_star { Not_paren_star } ) | Lparen_then_not_lparen_star | ( "*" { "*" } ) | not_rparen_star_then_rparen | embedded_remark } "*)" ;
// Remark : Embedded_remark | Tail_remark ;
// Remark_tag : "\"" Remark_ref { "." Remark_ref } "\"" ;
// Remark_ref : Attribute_ref | Constant_ref | Entity_ref | Enumeration_ref | Function_ref | Parameter_ref | Procedure_ref | Rule_label_ref | Rule_ref | Schema_ref | Subtype_constraint_ref | Type_label_ref | Type_ref | Variable_ref ;
// Tail_remark : "--"  Remark_tag  ;
// Special returns string: Not_paren_star_quote_special | "(" | ")" | "*" | "'" ;

// these are only for nested embedded remarks and parenthesis balance inside nested remarks 
// Lparen_then_not_lparen_star: "("+ Not_lparen_star+ ;
// Not_lparen_star: Not_paren_star | ")" ;
// Not_paren_star: Letter | Digit | Not_paren_star_special;
// Not_paren_star_special: Not_paren_star_quote_special | "'" ;
// Not_rparen_star: Not_paren_star | "(" ;
// Not_rparen_star_then_rparen: Not_rparen_star+ ")"+;

Encoded_string_literal returns string: "\"" Encoded_character+ "\"" ;
Encoded_character returns string: Octet Octet Octet Octet;
Octet returns string: Hex_digit Hex_digit ;
Hex_digit returns string: Digit | "a" | "b" | "c" | "d" | "e" | "f" ;

Redeclared_attribute: qualifiedAttribute=Qualified_attribute (isRenamed?="RENAMED" name=Simple_id)? ; 


Aggregate_type: "AGGREGATE" ( ":" type=Type_label )? "OF" of=Parameter_type ;
Generic_entity_type : "GENERIC_ENTITY" (":" type=Type_label )? ;
Generic_type: "GENERIC" ( ":" type=Type_label)? ;
Type_label returns string: Type_label_id | Type_label_ref ;
Type_label_id returns string: Simple_id ;



//Schema_version_id returns string: String_literal;




Numeric_expression: Simple_expression ;
Simple_expression  : left=Term ( op=Add_like_op right=Term )* ;
Term: left=Factor ( op=Multiplication_like_op right=Factor )* ;
Factor: factors+=Simple_factor ( "**" factors+=Simple_factor )? ;

/* 
Simple_factor:  Aggregate_initializer | Interval | Query_expression  | Temp |Entity_constructor | Enumeration_reference ;
Temp:  op=Unary_op? ( "(" expression=Expression ")" | primary=Primary )  ;
Primary: Literal | Qualified_Rep  ;
Qualified_Rep:factor=Qualifiable_factor (qualifiers+=Qualifier)*;
// Qualifiable_factor: isFunction=Function_call | isAttibuteRef=Attribute_ref | isConst=Constant_factor | isGeneralRef=General_ref | isPopulation=Population ;
Qualifiable_factor: Constant_factor  |  Qualifiable_ref| Population | Function_call;
Qualifiable_ref: reference=[GeneralAndAttribute:Simple_id] ;
type GeneralAndAttribute = Attribute_decl | Parameter_id | Variable_id ;
//for now we only support built-in constant
Constant_factor: constant=Built_in_constant;// | Constant_ref ;
*/

Simple_factor:  Aggregate_initializer | Interval | Query_expression  | Temp  ;
Temp:  op=Unary_op? ( "(" expression=Expression ")" | primary=Primary )  ;
Primary: Literal | Complex_Primary  ;
Complex_Primary: head=(Built_in_constant_or_function | Complex_Primary_id) body=Complex_Primary_body;
// TODO: due to syntax, attribute_qualifier has to be used for enum_ref if head is type_ref

Complex_Primary_body: parameterList=Actual_parameter_list? qualifiers+=Qualifier*;
Built_in_constant_or_function returns string: Built_in_constant | Built_in_function;
Complex_Primary_id: to=[Complex_Primary_ref:Simple_id];
type Complex_Primary_ref = Entity_head|Function_head|Attribute_decl|Parameter_id|Variable_id|Constant_body;
// TODO: enum_ref needs to be added since it can be used as head without type_ref

Attribute_ref: target=[Attribute_decl:Simple_id] ;
// Constant_ref returns string: Constant_id ;
Entity_ref: to=[Entity_head:Simple_id];
//Enumeration_ref returns string: Enumeration_id ;
Function_ref: function=[Function_head:Simple_id]; //returns string: Function_id ;
Parameter_ref : parameterReferenceTo=[Parameter_id:Simple_id] ;
Procedure_ref returns string: Procedure_id ;
//Rule_label_ref returns string: Rule_label_id ;
//Rule_ref returns string: Rule_id ;
Schema_ref returns string: Schema_id ;

//Schema_ref returns string:  ;
//Subtype_constraint_ref returns string: Subtype_constraint_id ;
Type_label_ref returns string: Type_label_id ;
Type_ref returns string: Type_id ;
Variable_ref: target=[Variable_id:Simple_id] ;

Constant_decl: "CONSTANT" items+=Constant_body+ "END_CONSTANT" ";" ;


Actual_parameter_list: "(" params+=Parameter? ( "," params+=Parameter )* ")" ; 
Add_like_op returns string: "+" | "-" | "OR" | "XOR" ;
Aggregate_initializer: "[" ( elts+=Element ("," elts+=Element )* )? "]" ;
Aggregate_source: expression=Simple_expression ;
Algorithm_head: declarations+=Declaration* constant=Constant_decl? local=Local_decl? ;
Alias_stmt  : "ALIAS" value=Variable_id "FOR" target=[General_ref:Simple_id] (qual=Qualifier) ";" stmts+=Stmt+ "END_ALIAS" ";" ;
Assignment_stmt  : ref=General_ref qualifiers+=Qualifier* ":=" expression=Expression ";";
Attribute_qualifier: ("." target=[Attribute_decl:Simple_id]) ;
Built_in_function returns string: "ABS" | "ACOS" | "ASIN" | "ATAN" | "BLENGTH" | "COS" | "EXISTS" | "EXP" | "FORMAT" | "HIBOUND" | "HIINDEX" | "LENGTH" | "LOBOUND" | "LOINDEX" | "LOG" | "LOG2" | "LOG10" | "NVL" | "ODD" | "ROLESOF" | "SIN" | "SIZEOF" | "SQRT" | "TAN" | "TYPEOF" | "USEDIN" | "VALUE" | "VALUE_IN" | "VALUE_UNIQUE" ;
Built_in_procedure returns string: "INSERT" | "REMOVE" ;
Case_action: labels+=Case_label ( "," labels+=Case_label )* ":" stmt=Stmt ;
Case_label: expr=Expression ;
Case_stmt  : "CASE" selector=Selector "OF" action=Case_action* ( "OTHERWISE" ":" stmt=Stmt )? "END_CASE" ";" ;
Compound_stmt  : "BEGIN" body+=Stmt+ "END" ";" ;
Constant_body: name=Simple_id ":" type=Instantiable_type ":=" expression=Expression ";" ;
// Constant_id returns string: Simple_id ;
Derived_attr: attribute=Attribute_decl ":" type=Parameter_type ":=" expression=Expression ";" ;
Domain_rule: (id=Simple_id ":")? expr=Expression";";
Element: expression=Expression  (":" rep=Repetition)?  ;
Entity_constructor: type=[Entity_head:Simple_id] "(" ( expr+=Expression ( "," expr+=Expression )* )? ")" ;
Entity_id returns string: Simple_id ;
Enumeration_id: name=Simple_id ;
Enumeration_reference:  (type=[Type_decl:Simple_id] "." )? ref=[Enumeration_id:Simple_id] ; //check
Escape_stmt returns string: "ESCAPE" ";" ;
Expression: left=Simple_expression (op=Rel_op_extended right=Simple_expression)? ;
Formal_parameter: ids+=Parameter_id ( "," ids+=Parameter_id )* ":" type=Parameter_type ;
Function_call: fct=( Built_in_function | Function_ref ) paramterList=Actual_parameter_list ;
Function_decl: head=Function_head algoHead=Algorithm_head stmts+=Stmt+ "END_FUNCTION" ";" ;
Function_head: "FUNCTION" name=Simple_id ( "(" parameters+=Formal_parameter ( ";" parameters+=Formal_parameter )* ")" )? ":" returnType=Parameter_type ";" ;
Function_id returns string: Simple_id ;
General_ref: reference=[GeneralRef] ;
type GeneralRef = Parameter_id | Variable_id;

Group_qualifier: "\\" entity=[Entity_head:Simple_id]  ;
EntityRef: entity=[Entity_head:Simple_id];
If_stmt  : "IF" condition=Logical_expression "THEN" body+=Stmt+ ("ELSE" elseBody+=Stmt+)? "END_IF" ";" ;
Increment: Numeric_expression ;
Increment_control: var=Variable_id ":=" lowerBound=Bound_1 "TO" upperBound=Bound_2  ("BY" increment=Increment)?  ;
Index: Numeric_expression ;
Index_1: Index ;
Index_2: Index ;
Index_qualifier: "[" index1=Index_1 ( ":" index2=Index_2 )? "]" ;
Interval: "{" low=Interval_low firstInterval=Interval_op item=Interval_item secondInterval=Interval_op high=Interval_high "}" ;
Interval_high: Simple_expression ;
Interval_item: Simple_expression ;
Interval_low: Simple_expression ;
Interval_op returns string: "<=" | "<" ;
Local_decl: "LOCAL" variables+=Local_variable+ "END_LOCAL" ";" ;
Local_variable: ids+=Variable_id ( "," ids+=Variable_id)* ":" type=Parameter_type ( ":=" Expression )? ";" ;
Logical_expression: Expression ;
Multiplication_like_op returns string: "*" | "/" | "DIV" | "MOD" | "AND" | "||" ;
Named_type_or_rename: type=Named_types ("AS" newName=( Entity_id | Type_id ) )? ;
Null_stmt returns string: ";" ;
Parameter: Expression ;
Parameter_id: name=Simple_id ;
Population: entity=[Entity_head:Simple_id];// returns string: Entity_ref ;
Procedure_call_stmt  : name=( Built_in_procedure | Procedure_ref ) parameterList=Actual_parameter_list ";" ;
Qualified_attribute : "SELF" group=Group_qualifier attribute=Attribute_qualifier ;
Qualifier: Attribute_qualifier | Group_qualifier | Index_qualifier ;
Query_expression: "QUERY" "(" variable=Variable_id "<*" source=Aggregate_source "|" expression=Logical_expression ")" ;
Referenced_attribute : Attribute_ref | Qualified_attribute ;
//Reference_clause: "REFERENCE" "FROM" schema=Schema_ref  "(" resources+=Resource_or_rename  ("," resources+=Resource_or_rename)*  ")"  ";" ;
Reference_clause: "REFERENCE" "FROM" schema=[Schema_decl:Simple_id]  ("(" resources+=Resource_or_rename  ("," resources+=Resource_or_rename)*  ")")?  ";" ;
Rel_op returns string: "<=" | ">=" | "<>" | "=" | ":<>:" | ":=:" | "<" | ">" ;
Rel_op_extended returns string: Rel_op | "IN" | "LIKE" ;
// Rename_id returns string: Constant_id | Entity_id | Function_id | Procedure_id | Type_id ;
Repeat_control: increment=Increment_control? while=While_control? until=Until_control?;
Repeat_stmt  : "REPEAT" control=Repeat_control ";" body+=Stmt+ "END_REPEAT" ";" ;
Repetition: expression=Numeric_expression ;
Resource_or_rename: resource=[NamedResource:Simple_id] (isRenamed?="AS" name=Simple_id)?;
//Resource_or_rename: Resource | Rename;
// Resource: ref=[Entity_head:Simple_id];
// Rename: sourceName=[Entity_head:Simple_id] "AS" ref=Simple_id;
//Resource_ref returns string: Constant_ref | Entity_ref | Function_ref | Procedure_ref | Type_ref ;
type NamedResource = Entity_head|Function_head|Procedure_head|Constant_body|Type_decl;
Return_stmt  : "RETURN" ( "(" expression=Expression ")" )? ";" ;
Rule_head: "RULE" name=Rule_id "FOR" "(" types+=Entity_ref ("," types+=Entity_ref )* ")" ";" ;
Rule_id returns string: Simple_id ;
Rule_label_id returns string: Simple_id ;
Selector: expression=Expression ;
Skip_stmt returns string: "SKIP" ";" ;

Stmt: Alias_stmt |  Case_stmt | Compound_stmt | Escape_stmt | If_stmt | Null_stmt | Procedure_call_Or_Assigment_stmt | Repeat_stmt | Return_stmt | Skip_stmt ;
// CUSTOM grammar fragment
Procedure_call_Or_Assigment_stmt: head=(Built_in_procedure|Procedure_call_Or_Assigment_stmt_ref) core=(Actual_parameter_list | Assignment_stmt_core) ";";
Procedure_call_Or_Assigment_stmt_ref: to=[Procedure_call_Or_Assigment_stmt_id];
Assignment_stmt_core: qualifiers+=Qualifier* ":=" expression=Expression;
type Procedure_call_Or_Assigment_stmt_id = General_id | Procedure_head;
type General_id = Variable_id | Parameter_id;

Total_over: "TOTAL_OVER" "(" entities+=Entity_ref ( "," entities+=Entity_ref )? ")" ";" ;
Type_decl: "TYPE" name=Simple_id "=" underlyingType=Underlying_type ";" where=Where_clause? "END_TYPE" ";" ;
Type_id returns string: Simple_id ;
Unary_op returns string: "+" | "-" | "NOT" ;
Unique_rule: ( name=Rule_label_id ":" )? attributes+=Referenced_attribute ( "," attributes+=Referenced_attribute )* ";" ;
Until_control: "UNTIL" expression=Logical_expression ;
Use_clause: "USE" "FROM" schema=Schema_ref ( "(" types+=Named_type_or_rename ( "," types+=Named_type_or_rename )* ")" )? ";" ;
Variable_id: name=Simple_id ;
While_control: "WHILE" expression=Logical_expression ;


// terminal Simple_id returns string: Letter (Letter | Digit | "_")* ;
terminal Self returns string: "SELF";
terminal Simple_id returns string: ID ;
terminal Slash returns string:("\\");
terminal NUM returns string: /\d+((\.\d+)?([eE][\-+]?\d+)?)?/;
terminal SIMPLE_STRING returns string: /\'(\\.|\\\\|[^'])*\'/;
terminal BINARY_LITERAL returns string:/(%[0-1]+)/;
hidden terminal WS: /\s+/;
hidden terminal SL_COMMENT:/(\-\-)[^\n\r]*/;
hidden terminal ML_COMMENT: /\(\*[\s\S]*?\*\)/;
terminal ID: /[_a-zA-Z][\w_]*/;
terminal Digit returns string: ('0'..'9');
terminal Letter: ('a'..'z') ;
terminal Not_paren_star_quote_special: "!" | '"' | "#" | "$" | "%" | "&" | "+" | "," | "-" | "." |
                              "/" | ":" | ";" | "<" | "=" | ">" | "?" | "@" | "[" | "\\" |
                              "]" | "^" | "_" | "{" | "|" | "}" | "~" ;
terminal Not_quote: Not_paren_star_quote_special | Letter | Digit | "(" | ")" | "*"  ;
