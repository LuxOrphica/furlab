Attribute VB_Name = "W_FormSetup"
Option Compare Database
Option Explicit

Public Sub W_CreateStage3Forms()
    ' UI lock: F1 is maintained manually during redesign and must not be overwritten.
    ' CreateSF1_ScrapPieceList
    ' CreateF1_ScrapPieceRegistry
    CreateSF2_ScrapTransactionHistory
    CreateSF2_UsageHistory
    CreateF2_ContourJson
    ' UI lock: F2 card is maintained manually during redesign and must not be overwritten.
    ' CreateF2_ScrapPieceCard
    ' Reservation is now handled directly in F2_ScrapPieceCard.
    ' Keep F3 builder as legacy only (not part of default Stage 3 rebuild).
    ' CreateF3_ReservationOperation
    CreateF4_UsageHistory
    CreateF_R1_PickList
    CreateF_R2_Traceability
    W_HideLegacyForms

    MsgBox "Stage 3 forms created:" & vbCrLf & _
           "- SF1_ScrapPieceList" & vbCrLf & _
           "- F1_ScrapPieceRegistry" & vbCrLf & _
           "- F2_ScrapPieceCard" & vbCrLf & _
           "- Reservation actions: in F2_ScrapPieceCard" & vbCrLf & _
           "- F4_UsageHistory" & vbCrLf & _
           "- F_R1_PickList" & vbCrLf & _
           "- F_R2_Traceability" & vbCrLf & _
           "(debug forms hidden: Z_Debug_ContourJson)", vbInformation, "W form setup"
End Sub

Public Sub W_HideLegacyForms()
    On Error Resume Next
    ' Keep legacy forms in DB for fallback, but hide from Navigation Pane.
    Application.SetHiddenAttribute acForm, "F3_ReservationOperation", True
    Err.Clear
    On Error GoTo 0
End Sub

Public Sub W_RebuildF1Hard()
    On Error GoTo ErrHandler

    On Error Resume Next
    DoCmd.Close acForm, "F1_ScrapPieceRegistry", acSaveNo
    Err.Clear
    On Error GoTo ErrHandler

    DeleteFormIfExists "SF1_ScrapPieceList"
    DeleteFormIfExists "F1_ScrapPieceRegistry"
    CreateSF1_ScrapPieceList
    CreateF1_ScrapPieceRegistry
    W_F1_RepairFilterCombos
    DoCmd.OpenForm "F1_ScrapPieceRegistry", acNormal
    MsgBox "F1 rebuilt from scratch. Check button 'Apply' in header.", vbInformation, "F1 rebuild"
    Exit Sub

ErrHandler:
    MsgBox "F1 hard rebuild failed: " & Err.Description, vbExclamation, "F1 rebuild"
End Sub

Public Sub W_NormalizeCoreFormWidths()
    On Error GoTo ErrHandler
    NormalizeOneFormWidth "F1_ScrapPieceRegistry", FORM_STD_WIDTH
    NormalizeOneFormWidth "F2_ScrapPieceCard", FORM_STD_WIDTH
    NormalizeOneFormWidth "F4_UsageHistory", FORM_STD_WIDTH
    MsgBox "Core form widths normalized to " & CStr(FORM_STD_WIDTH) & ".", vbInformation, "Form geometry"
    Exit Sub
ErrHandler:
    MsgBox "Normalize form widths failed: " & Err.Description, vbExclamation, "Form geometry"
End Sub

Private Sub NormalizeOneFormWidth(ByVal formName As String, ByVal widthTwips As Long)
    On Error GoTo ExitSub
    Dim wasOpen As Boolean
    wasOpen = CurrentProject.AllForms(formName).IsLoaded
    If wasOpen Then DoCmd.Close acForm, formName, acSaveYes
    DoCmd.OpenForm formName, acDesign
    Forms(formName).Width = widthTwips
    DoCmd.Close acForm, formName, acSaveYes
    If wasOpen Then DoCmd.OpenForm formName, acNormal
ExitSub:
End Sub
